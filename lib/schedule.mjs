// A throttle with a deadline: run fn at most once per `ms`, and within `ms` of a request however often requests come (a
// debounce that restarts on every event would never run under a busy mempool). The clock is injectable for the tests.
export function throttle(fn, ms, { now = () => Date.now(), set = setTimeout } = {}) {
  let timer = null,
    last = -Infinity;
  return () => {
    if (timer) return false;
    timer = set(
      () => {
        timer = null;
        last = now();
        fn();
      },
      Math.max(0, ms - (now() - last)),
    );
    return true;
  };
}
