// Bootstrap-only singleflight. A completed verification is never cached here;
// transaction drafts must continue to perform their own fresh verification.
export function createFactoryRefresh(chain, deployment, verify) {
  let pending = null;
  return async function refreshFactory() {
    if (!deployment) return;
    if (!pending)
      pending = Promise.resolve()
        .then(() => verify(chain, deployment))
        .then((trust) => {
          Reflect.set(chain, "factoryTrust", trust);
          Reflect.set(chain, "verifiedFactory", true);
        })
        .catch(() => {
          Reflect.set(chain, "factoryTrust", null);
          Reflect.set(chain, "verifiedFactory", false);
        })
        .finally(() => {
          pending = null;
        });
    await pending;
  };
}
