# Contributing to StratCraft

Thank you for your interest in contributing to StratCraft. This document explains what contributions are welcome and how the review process works.

## Contribution Scope

This repository is the public open-source StratCraft release. Contributions are welcome for code and docs that live in this repository.

### Accepted Contributions

- **Sample strategies** - Example Python strategy files that demonstrate patterns and techniques
- **Documentation** - Improvements to README, guides, tutorials, and code comments
- **Data adapters** - New free or open data provider integrations
- **Bug fixes** - Fixes for issues within the public repository
- **Tests** - Additional test coverage for existing features
- **Localization** - Translation files for new languages

### Out of Scope

The following areas are not maintained in this public repository:

- Advanced Strategy Builder modes not shipped here
- Signal Discovery, Alpha Factory, and related advanced workflows
- advanced data integrations such as ClickHouse
- Live trading, broker bridge, and signal engine
- Advanced analytics and optimization layers not present here
- Server-side generation templates and prompt pipelines
- Entitlement, licensing, and authentication services outside the public release

If you are unsure whether a contribution falls within scope, open an issue before starting work.

## How to Contribute

### 1. Open an Issue First

For anything beyond a trivial fix, open an issue describing what you want to change and why. This helps confirm the change is in scope before you invest time.

### 2. Fork and Branch

```bash
git clone https://github.com/YOUR_USERNAME/StratCraft.git
cd StratCraft
git checkout -b your-feature-branch
```

### 3. Make Your Changes

- Follow existing code style and conventions
- Include tests for new functionality
- Keep changes focused and minimal
- Write clear commit messages

### 4. Submit a Pull Request

- Open a PR against the `main` branch
- Describe what the change does and why
- Reference any related issues
- Ensure CI checks pass

## Review Process

StratCraft uses a public-to-private review flow:

1. You submit a PR to this public repository
2. A maintainer reviews for scope compliance and code quality
3. Accepted changes are integrated into the private development repository
4. Changes are synced back to this public repository in the next release cycle

This means there may be a delay between PR acceptance and the change appearing here.

## Code of Conduct

- Be respectful and constructive in all interactions
- Focus on technical merit in code reviews
- Report security vulnerabilities privately as described in [SECURITY.md](SECURITY.md)

## Development Setup

```bash
# Prerequisites: Node.js 20+, pnpm 9+, CMake 3.20+, Python 3.10+

pnpm install
pnpm dev:desktop
```

See [README.md](README.md) for full setup instructions.

## License

By contributing, you agree that your contributions will be licensed under the [AGPL-3.0](LICENSE) license.
