# Security and privacy

Do not put conversation exports, browser profiles, authentication files, session tokens, or private attachment URLs in issues or pull requests. Use small synthetic examples.

The local application binds to loopback only. It exposes read-only session discovery and export operations, checks origins and a custom request header, and rejects sources disabled in its edition. It is not designed to run on a public server or behind a network proxy. A local administrator or malicious software running on the same computer can still access local files.

Browser exports contact the original chat and media providers. Preview HTML is sanitized and conversations are not sent to an exporter service. Provider file retention and browser memory limits still apply.

The public release must be built from reviewed source with fresh history, not by making the private repository public. Publishing is blocked in the private edition. Review `npm audit` when preparing releases; development servers should never be exposed to untrusted networks.
