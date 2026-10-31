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

# Claude Code, for the `validate` and `plugin-test` commands: the same pinned
# platform package .github/workflows/plugin-validate.yml fetches, fetched the
# same way, with `npm pack` and `tar` and no install, so no package script runs.
# The pins move together; docs/security/scanners.md says how to bump them. The
# fetch is at build time: athanor runs the commands with no network. The mod's
# tests that build a junction are not declared here, as on any host but
# Windows, and the run prints their titles (#481). The folder goes last on PATH, so nothing in the package can stand in for the
# image's own sh, node or git.
#
# The tarball is held to its sha512 before it is unpacked: the registry's
# published `integrity` for this version, in hex, read with
# `npm view @anthropic-ai/claude-code-linux-x64@<version> dist.integrity`. This
# image runs on the owner's machine, which the CI jobs' version-only pin does
# not reach (#477). A bump changes the hash with the version.
RUN mkdir -p /opt/claude \
 && cd /opt/claude \
 && npm pack --ignore-scripts @anthropic-ai/claude-code-linux-x64@2.1.314 \
 && echo "620d1ae66a5d9060a52b4ae014cc5b096656df066daa03a16236c84802eac8be6d7c00c7857f4cb3a131034fde7df81227d31a59f1cc3e7b6bc9e386e8c93a1d  anthropic-ai-claude-code-linux-x64-2.1.314.tgz" | sha512sum -c - \
 && tar -xzf anthropic-ai-claude-code-linux-x64-2.1.314.tgz \
 && rm anthropic-ai-claude-code-linux-x64-2.1.314.tgz \
 && npm cache clean --force
ENV PATH="$PATH:/opt/claude/package" \
    DISABLE_AUTOUPDATER=1 \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1

# The image's own non-root user. athanor copies the snapshot into $HOME/work and
# runs the commands there, so the user must own its home.
USER node
