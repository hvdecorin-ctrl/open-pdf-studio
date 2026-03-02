import { createSignal } from 'solid-js';

const [items, setItems] = createSignal([]);
const [countText, setCountText] = createSignal('0 annotations');
const [emptyMessage, setEmptyMessage] = createSignal('');
const [sortMode, setSortMode] = createSignal('page');
const [filterMode, setFilterMode] = createSignal('all');
const [collapsedGroups, setCollapsedGroups] = createSignal(new Set());

function toggleGroup(groupKey) {
  setCollapsedGroups(prev => {
    const next = new Set(prev);
    if (next.has(groupKey)) next.delete(groupKey);
    else next.add(groupKey);
    return next;
  });
}

function expandAllGroups() {
  setCollapsedGroups(new Set());
}

function collapseAllGroups(allKeys) {
  setCollapsedGroups(new Set(allKeys));
}

export {
  items, setItems,
  countText, setCountText,
  emptyMessage, setEmptyMessage,
  sortMode, setSortMode,
  filterMode, setFilterMode,
  collapsedGroups, toggleGroup, expandAllGroups, collapseAllGroups,
};
