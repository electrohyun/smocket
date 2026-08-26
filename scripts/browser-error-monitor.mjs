function describeEntry(entry) {
  return `${entry.label} ${entry.type}: ${entry.message}`;
}

function validateAllowed(allowed) {
  for (const candidate of allowed) {
    if (typeof candidate.message === 'string') continue;
    if (
      !candidate.message.source.startsWith('^') ||
      !candidate.message.source.endsWith('$') ||
      candidate.message.global ||
      candidate.message.sticky
    ) {
      throw new Error(
        'browser error allowlist regular expressions must be anchored with ^ and $ and must not use global or sticky flags',
      );
    }
  }
}

function matchesAllowed(entry, allowed) {
  return allowed.some(
    (candidate) =>
      candidate.type === entry.type &&
      (typeof candidate.message === 'string'
        ? candidate.message === entry.message
        : candidate.message.test(entry.message)),
  );
}

export function createBrowserErrorMonitor({ allowed = [] } = {}) {
  validateAllowed(allowed);
  const entries = [];
  const unexpected = [];
  const registrations = [];
  const waiters = [];
  let stopped = false;

  function record(entry) {
    entries.push(entry);
    if (!matchesAllowed(entry, allowed)) unexpected.push(entry);
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      if (!waiter || waiter.type !== entry.type || waiter.message !== entry.message) continue;
      waiters.splice(index, 1);
      waiter.resolve();
    }
  }

  return {
    observe(page, label) {
      if (stopped) throw new Error('cannot observe a page after browser error monitoring stops');
      const onPageError = (error) =>
        record({
          label,
          type: 'pageerror',
          message: error instanceof Error ? error.message : String(error),
        });
      const onConsole = (message) => {
        if (message.type() !== 'error') return;
        record({ label, type: 'console.error', message: message.text() });
      };
      page.on('pageerror', onPageError);
      page.on('console', onConsole);
      registrations.push({ page, onPageError, onConsole });
    },

    waitFor(type, message) {
      if (entries.some((entry) => entry.type === type && entry.message === message)) {
        return Promise.resolve();
      }
      return new Promise((resolve) => waiters.push({ type, message, resolve }));
    },

    stop() {
      if (stopped) return;
      stopped = true;
      for (const { page, onPageError, onConsole } of registrations) {
        page.off('pageerror', onPageError);
        page.off('console', onConsole);
      }
    },

    assertNoUnexpectedErrors() {
      this.stop();
      if (unexpected.length === 0) return;
      throw new Error(
        `Unexpected browser errors:\n${unexpected.map((entry) => `- ${describeEntry(entry)}`).join('\n')}`,
      );
    },
  };
}
