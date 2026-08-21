// [snippet:start smocket-client-substitution]
export async function resolve(specifier, context, nextResolve) {
  const fromSmocketBuild = context.parentURL?.includes('/examples/drawing-game/dist/smocket/');
  if (specifier === 'socket.io-client' && fromSmocketBuild) {
    return nextResolve(
      new URL('../../packages/smocket-client/dist/index.mjs', import.meta.url).href,
      context,
    );
  }
  const fromSmocketClient = context.parentURL?.includes('/packages/smocket-client/dist/');
  if (specifier === 'smocket' && (fromSmocketBuild || fromSmocketClient)) {
    return nextResolve(new URL('../../dist/index.js', import.meta.url).href, context);
  }
  return nextResolve(specifier, context);
}
// [snippet:end smocket-client-substitution]
