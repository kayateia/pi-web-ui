/**
 * 左栏「运行的对话」的分组（跨项目）：当前项目排最前、不显示组标题（项目名），
 * 其余项目按路径稳定排序并挂上组标题。
 *
 * 抽成纯函数是为了那个「切项目时项目名闪一下」的坑（#140 的回归），有单测：
 * `tests/unit/conv-groups.test.ts`。
 */
import type { ConversationCategory, ConversationSummary } from "./types";

interface ConvGroup {
	cwd: string;
	isCurrent: boolean;
	convs: ConversationSummary[];
}

/** One user-defined category bucket; id=null is the virtual Uncategorized bucket. */
export interface ConversationCategoryGroup<T> {
	id: string | null;
	name: string;
	items: T[];
}

/**
 * Group conversations or sessions into user-defined topic buckets.
 *
 * Category order comes from the durable category list. Pinned rows sort first
 * inside each bucket without changing the relative order of the remaining rows.
 * Unknown/stale category ids fall back to Uncategorized.
 */
export function groupByConversationCategory<T extends { categoryId?: string; pinned?: boolean }>(
	items: readonly T[],
	categories: readonly ConversationCategory[],
	includeEmpty: boolean,
): ConversationCategoryGroup<T>[] {
	const known = new Map(categories.map((category) => [category.id, category]));
	const buckets = new Map<string | null, T[]>();
	for (const category of categories) buckets.set(category.id, []);
	for (const item of items) {
		const categoryId = item.categoryId && known.has(item.categoryId) ? item.categoryId : null;
		const bucket = buckets.get(categoryId) ?? [];
		bucket.push(item);
		buckets.set(categoryId, bucket);
	}
	if (!buckets.has(null)) buckets.set(null, []);
	const ordered: ConversationCategoryGroup<T>[] = categories.map((category) => ({
		id: category.id,
		name: category.name,
		items: buckets.get(category.id) ?? [],
	}));
	ordered.push({ id: null, name: "", items: buckets.get(null) ?? [] });
	return ordered
		.filter((bucket) => includeEmpty || bucket.id === null || bucket.items.length > 0)
		.map((bucket) => ({
			...bucket,
			items: [...bucket.items].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))),
		}))
		.filter((bucket) => includeEmpty || bucket.items.length > 0);
}

/**
 * Group the (now cross-project) running-conversation list by workspace,
 * current project first, others in stable path order. Lets the left panel
 * disambiguate same-titled chats across projects and shows where each
 * background run lives.
 *
 * 「当前项目」取哪个信号：`set_cwd` / 跨项目切对话时，服务端先推 `conversations`
 * （activeId 已经是新项目的对话），带新 `cwd` 的快照随后才到 —— 两个信号不同时
 * 到达。所以**只要当前对话在列表里，就认它所在的分组为当前项目**（唯一），
 * `currentCwd` 只作为它不在列表里时（空白新对话）的回落。只按 `cwd` 判定的那一
 * 帧会把当前项目当成「别的项目」，于是它顶上闪一下项目名再消失（实测约 8ms 一帧，
 * 正是用户看到的那一跳）；同一组立即置顶，也免掉了随后的位置跳动。
 */
export function groupConversations(
	list: ConversationSummary[],
	currentCwd: string,
	activeConversationId: string,
): ConvGroup[] {
	const byId = new Map(list.map((c) => [c.id, c]));
	/** Resolve the whole ancestry before splitting the list into project groups. */
	const resolvedCwds = new Map<string, string>();
	const groupCwdOf = (c: ConversationSummary): string => {
		const path: ConversationSummary[] = [];
		const positions = new Map<string, number>();
		let current = c;
		let groupCwd: string;
		for (;;) {
			const cached = resolvedCwds.get(current.id);
			if (cached !== undefined) {
				groupCwd = cached;
				break;
			}
			const cycleStart = positions.get(current.id);
			if (cycleStart !== undefined) {
				// Malformed cycles still share one deterministic group, regardless of list order.
				const cycle = path.slice(cycleStart);
				const anchor = cycle.reduce((a, b) => (a.id < b.id ? a : b));
				groupCwd = anchor.cwd;
				break;
			}
			positions.set(current.id, path.length);
			path.push(current);
			const parent = current.parentId ? byId.get(current.parentId) : undefined;
			if (!parent) {
				groupCwd = current.cwd;
				break;
			}
			current = parent;
		}
		for (const ancestor of path) resolvedCwds.set(ancestor.id, groupCwd);
		return groupCwd;
	};
	const activeConv = list.find((c) => c.id === activeConversationId);
	const effectiveCwd = activeConv ? groupCwdOf(activeConv) : currentCwd;

	const byCwd = new Map<string, ConversationSummary[]>();
	for (const c of list) {
		const groupCwd = groupCwdOf(c);
		const arr = byCwd.get(groupCwd) ?? [];
		arr.push(c);
		byCwd.set(groupCwd, arr);
	}
	const groups: ConvGroup[] = [...byCwd.entries()].map(([cwd, convs]) => ({
		cwd,
		isCurrent: cwd === effectiveCwd,
		convs,
	}));
	groups.sort((a, b) => (a.isCurrent ? -1 : b.isCurrent ? 1 : a.cwd < b.cwd ? -1 : a.cwd > b.cwd ? 1 : 0));
	return groups;
}

export interface ConvRowItem {
	c: ConversationSummary;
	depth: number;
	hasKids: boolean;
	isCollapsed: boolean;
	descendantCount: number;
	hasStreaming: boolean;
	hasError: boolean;
	hasQuestion: boolean;
}

/**
 * 将同组内的对话按父子树展开成扁平渲染行列表（issue #564）。
 * 当父对话处于折叠状态时，其所有后代子代理从行列表中隐藏，并在父行上汇总后代计数与活跃状态。
 */
export function buildConversationRows(
	convs: ConversationSummary[],
	collapsedParentIds: Set<string> = new Set(),
): ConvRowItem[] {
	const byId = new Map(convs.map((x) => [x.id, x]));
	const kids = new Map<string, ConversationSummary[]>();
	const roots: ConversationSummary[] = [];

	for (const x of convs) {
		if (x.parentId && byId.has(x.parentId)) {
			const arr = kids.get(x.parentId) ?? [];
			arr.push(x);
			kids.set(x.parentId, arr);
		} else {
			roots.push(x);
		}
	}

	const getDescendants = (id: string): ConversationSummary[] => {
		const res: ConversationSummary[] = [];
		const queue = [...(kids.get(id) ?? [])];
		const visited = new Set<string>();
		while (queue.length > 0) {
			const item = queue.shift()!;
			if (visited.has(item.id)) continue;
			visited.add(item.id);
			res.push(item);
			const sub = kids.get(item.id);
			if (sub) queue.push(...sub);
		}
		return res;
	};

	const rows: ConvRowItem[] = [];
	const seen = new Set<string>();
	const hidden = new Set<string>();

	const append = (c: ConversationSummary, depth: number) => {
		if (seen.has(c.id) || hidden.has(c.id)) return;
		seen.add(c.id);

		const myKids = kids.get(c.id) ?? [];
		const hasKids = myKids.length > 0;
		const isCollapsed = hasKids && collapsedParentIds.has(c.id);

		let descendantCount = 0;
		let hasStreaming = false;
		let hasError = false;
		let hasQuestion = false;

		if (hasKids) {
			const descendants = getDescendants(c.id);
			descendantCount = descendants.length;
			hasStreaming = descendants.some((d) => d.isStreaming);
			hasError = descendants.some((d) => Boolean(d.error));
			hasQuestion = descendants.some((d) => Boolean(d.hasQuestion));

			if (isCollapsed) {
				for (const d of descendants) {
					hidden.add(d.id);
				}
			}
		}

		rows.push({
			c,
			depth,
			hasKids,
			isCollapsed,
			descendantCount,
			hasStreaming,
			hasError,
			hasQuestion,
		});

		if (!isCollapsed) {
			for (const child of myKids) append(child, depth + 1);
		}
	};

	for (const root of roots) append(root, 0);
	for (const orphan of convs) append(orphan, 0);

	return rows;
}
