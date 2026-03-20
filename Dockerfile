FROM rust:1.80-bullseye

# Install basic tools
RUN apt-get update && apt-get install -y \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 22
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs

# Install Claude Code
RUN npm install -g @anthropic-ai/claude-code

# Install wasm-pack
RUN curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

# Add WebAssembly target for Rust
RUN rustup target add wasm32-unknown-unknown

# Set working directory
WORKDIR /workspace

# By default, keep the container running so you can attach to it, 
# or you can override this command to run the dev server.
CMD ["sleep", "infinity"]
