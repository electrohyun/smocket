export async function resolve(specifier, context, nextResolve) {
  const fromGoldenBuild = context.parentURL?.includes('/examples/drawing-game/dist/real/');
  if (specifier === 'socket.io-client' && fromGoldenBuild) {
    return nextResolve(
      new URL('./stage-sources/08-full-workflow.mjs', import.meta.url).href,
      context,
    );
  }
  return nextResolve(specifier, context);
}
