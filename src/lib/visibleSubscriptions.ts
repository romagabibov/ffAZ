type Group = { ids: string[]; stop: () => void };

/** Keep subscriptions for existing pages when more items are appended. */
export function visibleSubscriptions(subscribe: (ids: string[]) => () => void, size = 10) {
  const groups = new Set<Group>();
  return {
    update(ids: string[]) {
      const visible = new Set(ids);
      for (const group of groups) {
        if (group.ids.some(id => !visible.has(id))) {
          group.stop();
          groups.delete(group);
        } else {
          group.ids.forEach(id => visible.delete(id));
        }
      }
      const missing = [...visible];
      for (let offset = 0; offset < missing.length; offset += size) {
        const part = missing.slice(offset, offset + size);
        groups.add({ ids: part, stop: subscribe(part) });
      }
    },
    stop() {
      for (const group of groups) group.stop();
      groups.clear();
    },
  };
}
