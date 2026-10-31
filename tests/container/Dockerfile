# The image athanor runs grimoire's checks in. Its build context is this folder
# alone. It installs nothing from npm: the one npm fetch below downloads Claude
# Code's binary and unpacks it, and runs no install.
#
# node:24-bookworm-slim, pinned by digest so a moved tag cannot change what runs
# the checks without a reviewed change. Node 24 is the repository's floor. The
# digest is the multi-platform index; to move it, pull the tag, read its new
# digest from `docker buildx imagetools inspect`, and review the diff here.
FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205

# git, because athanor's boot script commits the snapshot only when the image has
# it, and the tests and rule 2b of scripts/check.mjs need a repository. The
# package comes from Debian's archive at build time and is not pinned, so the
# digest above holds the base image and not git.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git \
 && rm -rf /var/lib/apt/lists/*

# Claude Code, for the `validate` command: the same pinned platform package
# .github/workflows/plugin-validate.yml fetches, fetched the same way, with
# `npm pack` and `tar` and no install, so no package script runs. The pins
# move together; docs/security/scanners.md says how to bump them. The fetch is
# at build time: athanor runs the commands with no network. The mod's tests,
# `claude plugin test .`, are not run here: they need a Windows host.
RUN mkdir -p /opt/claude \
 && cd /opt/claude \
 && npm pack --ignore-scripts @anthropic-ai/claude-code-linux-x64@2.1.314 \
 && tar -xzf anthropic-ai-claude-code-linux-x64-2.1.314.tgz \
 && rm anthropic-ai-claude-code-linux-x64-2.1.314.tgz \
 && npm cache clean --force
ENV PATH="/opt/claude/package:$PATH" \
    DISABLE_AUTOUPDATER=1 \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1

# The image's own non-root user. athanor copies the snapshot into $HOME/work and
# runs the commands there, so the user must own its home.
USER node
