// [maintenance-snippet:start base-client-substitution]
export async function resolve(specifier, context, nextResolve) {
  const fromGoldenBuild = context.parentURL?.includes('/examples/drawing-game/dist/real/');
  if (specifier === 'socket.io-client' && fromGoldenBuild) {
    return nextResolve(new URL('./handwritten-socket.mjs', import.meta.url).href, context);
  }
  return nextResolve(specifier, context);
}
// [maintenance-snippet:end base-client-substitution]
