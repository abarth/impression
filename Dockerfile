FROM rust:1.85-bullseye

# Install basic tools
RUN apt-get update && apt-get install -y \
    curl \
    build-essential \
    vim \
    && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI
RUN mkdir -p -m 755 /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update \
    && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Install wasm-pack
RUN curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

# Add WebAssembly target for Rust
RUN rustup target add wasm32-unknown-unknown

# Install wasm-bindgen-cli from source (matching Cargo.lock version)
# so it works on bullseye's glibc, since wasm-pack's prebuilt binary needs glibc 2.32+
RUN cargo install wasm-bindgen-cli@0.2.114

# Install Node.js 22
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs

# Install Claude Code
RUN npm install -g @anthropic-ai/claude-code

# Install GitHub Copilot CLI
RUN npm install -g @github/copilot

# Set working directory
WORKDIR /workspace

# By default, keep the container running so you can attach to it, 
# or you can override this command to run the dev server.
CMD ["sleep", "infinity"]
