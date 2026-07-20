/**
 * Guard against out-of-order async responses. Each loader owns one guard;
 * calling it marks a new request and returns an `isLatest` check. A response
 * may only be applied (and the loading flag cleared) while its request is
 * still the latest — otherwise a slow stale request (e.g. new window + old
 * playlist, racing the playlist-reset reload) would overwrite fresh data.
 */
export function latestGuard(): () => () => boolean {
  let current = 0;
  return () => {
    const id = ++current;
    return () => id === current;
  };
}
