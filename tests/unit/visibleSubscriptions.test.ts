import { describe, expect, it, vi } from 'vitest';
import { visibleSubscriptions } from '../../src/lib/visibleSubscriptions';

describe('Visible reaction subscriptions', () => {
  it('keeps existing queries when the next page is appended and when posts reorder', () => {
    const stops: Array<ReturnType<typeof vi.fn>> = [];
    const subscribe = vi.fn(() => {
      const stop = vi.fn();
      stops.push(stop);
      return stop;
    });
    const subscriptions = visibleSubscriptions(subscribe);
    const ids = Array.from({ length: 48 }, (_, index) => 'post-' + index);
    subscriptions.update(ids.slice(0, 24));
    expect(subscribe).toHaveBeenCalledTimes(3);
    subscriptions.update(ids);
    expect(subscribe).toHaveBeenCalledTimes(6);
    expect(stops.every(stop => stop.mock.calls.length === 0)).toBe(true);
    subscriptions.update([...ids].reverse());
    expect(subscribe).toHaveBeenCalledTimes(6);
    subscriptions.stop();
    expect(stops.every(stop => stop.mock.calls.length === 1)).toBe(true);
  });

  it('releases removed pages and leaves no active subscriptions after sign-out', () => {
    const stops: Array<ReturnType<typeof vi.fn>> = [];
    const subscriptions = visibleSubscriptions(() => {
      const stop = vi.fn();
      stops.push(stop);
      return stop;
    });
    subscriptions.update(['a', 'b', 'c']);
    subscriptions.update([]);
    expect(stops[0]).toHaveBeenCalledOnce();
    subscriptions.stop();
    expect(stops[0]).toHaveBeenCalledOnce();
  });
});
