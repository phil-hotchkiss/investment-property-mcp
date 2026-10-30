# Secrets

API keys live in the macOS Keychain under the service `rental-deal-math`, not in `.zshrc` or `.env`.

Store the key once: `python3 scripts/keychain.py set ANTHROPIC_API_KEY`, then paste it when prompted. It never goes through argv or shell history.

Load it into a shell session with `eval "$(pnpm -s evals:env)"`. The key exists only in that session's environment.

Other commands: `get NAME` prints a value, `delete NAME` removes it, `env NAME...` prints export lines.

CI runs on Linux, where there is no Keychain. Add a repo secret with the same name, expose it as an env var, and `get` falls back to it.
