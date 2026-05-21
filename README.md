# llamacpp-launcher

> A terminal UI for configuring and launching the `llama.cpp` server (`llama-server` on macOS, `llama-server.exe` on Windows) on **macOS (Apple Silicon, Metal)** and **Windows**. It is self-bootstrapping: it can install its own runtime, clone and build llama.cpp for you, discover GGUF models, estimate memory fit against detected hardware, and build the server command line through an interactive set of screens.

You normally do not need to download or compile anything by hand. Run the launcher and it sets up what it needs.

## Features

- **Self-bootstrapping runtime.** A double-clickable launcher detects or installs Node.js and Git automatically, then installs (or updates) and starts the packaged app. On **Windows** this is `llamacpp-launcher.bat` (Node.js + Git via winget, with a direct-download fallback); on **macOS** it is `llamacpp-launcher.command` (Node.js via Homebrew, falling back to the official build from nodejs.org; Git via Homebrew or the Xcode Command Line Tools).
- **Automated llama.cpp build.** The first-run wizard can clone llama.cpp from GitHub and compile the server for you — including the web UI — without leaving the TUI: `llama-server` with **Metal** on macOS (single-config CMake → `build/bin/`), or `llama-server.exe` with CUDA/CPU on Windows.
- **Prerequisite auto-install.** The install wizard detects the toolchain and can auto-install the missing critical pieces. **macOS:** Xcode Command Line Tools, CMake, Git, Node.js, Homebrew, and a Metal GPU — auto-installs via `xcode-select --install` and Homebrew. **Windows:** Git, Visual Studio 2022 C++ Build Tools (CMake), CUDA Toolkit, Node.js, and an NVIDIA GPU — auto-installs Git, Node.js, and the VS 2022 Build Tools.
- **GPU-aware builds.** On macOS the build enables **Metal**, and memory-fit accounts for Apple Silicon's **unified memory** (the GPU shares system RAM). On Windows, when an NVIDIA GPU and CUDA Toolkit are present the build enables CUDA and targets the detected GPU architecture; otherwise it builds CPU-only.
- **Update in place.** An existing llama.cpp clone can be updated with `git pull` and rebuilt.
- Interactive terminal UI built with [Ink](https://github.com/vadimdemedes/ink) and React.
- Lists local GGUF models from the Hugging Face cache, and accepts Hugging Face repository references for remote models.
- Reads GGUF metadata (architecture, layer count, training context length, quantization type) from local files and remote repositories.
- Estimates KV cache size and total memory need, then reports whether a model fits in VRAM, partially offloads, or runs from RAM, and recommends a GPU layer count.
- Quantization picker for Hugging Face repositories with per-file fit status.
- Sampling parameter profiles matched per model family (`presets.json`), a custom-parameter editor, an expert mode for raw `llama-server` arguments, and a per-model chat template override.

## Prerequisites

In the common case you only need a supported OS (**macOS** on Apple Silicon, or **Windows**) and an **internet connection**. The launcher and its wizard install everything else.

### macOS (Apple Silicon)

| Component | Needed for | How it is obtained |
| --- | --- | --- |
| macOS on Apple Silicon | Metal-accelerated `llama-server`. | Host OS (Intel Macs work best-effort). |
| Xcode Command Line Tools | The clang compiler used to build llama.cpp. | Auto-installed by the wizard via `xcode-select --install`. |
| CMake | Configuring/compiling the build. | Auto-installed via Homebrew (`brew install cmake`). |
| Git | Cloning and updating llama.cpp. | Auto-installed by the bootstrapper/wizard via Homebrew or the Xcode Command Line Tools. |
| Node.js `^20.19.0 \|\| ^22.13.0 \|\| >=24.0.0` | Running the launcher; building the web UI. | Auto-installed by the bootstrapper (Homebrew, or a direct download from nodejs.org) and the wizard. |
| Homebrew | Fetching CMake/Node for auto-install. | Optional but recommended — install from [brew.sh](https://brew.sh). |
| Metal | GPU acceleration. | Built into macOS; nothing to install. |

### Windows

| Component | Needed for | How it is obtained |
| --- | --- | --- |
| Windows | The launcher targets `llama-server.exe` and Windows tooling. | Host OS (required). |
| Node.js `^20.19.0 \|\| ^22.13.0 \|\| >=24.0.0` | Running the launcher; building the llama.cpp web UI. | Auto-installed by the bootstrapper / wizard if missing. |
| Git | Cloning and updating llama.cpp. | Auto-installed when needed. |
| Visual Studio 2022 C++ Build Tools (CMake) | Compiling `llama-server.exe`. | Auto-installed by the install wizard. |
| CUDA Toolkit + NVIDIA GPU | GPU-accelerated build. | Optional. Without them the build is CPU-only; these are detected but not auto-installed. |
| winget | Fetching the auto-installable packages. | Used if present; a direct download fallback runs otherwise. |

If you already have a compiled llama.cpp, you can skip the build entirely and just point the launcher at that directory — `<dir>/build/bin/llama-server` on macOS, or `<dir>/build/bin/Release/llama-server.exe` on Windows.

## Installation

### Windows: run the bootstrapper

`llamacpp-launcher.bat` is a self-contained installer/launcher. Place a packaged `llamacpp-launcher-<version>.tgz` (produced by `npm run pack`) next to the `.bat` file and run it. The script:

1. Locates or installs a supported Node.js runtime and Git.
2. Installs (or updates) the packaged app into a per-user prefix under `%LOCALAPPDATA%\llamacpp-launcher`.
3. Hands off to `cmd.exe` to run the interactive TUI.

A log is written to `llamacpp-launcher.log` next to the `.bat` file. On first run, choose **"No, install it for me"** to have the wizard clone and build llama.cpp.

### macOS: run the bootstrapper

`llamacpp-launcher.command` is the macOS counterpart to the `.bat` — a self-contained installer/launcher. Place a packaged `llamacpp-launcher-<version>.tgz` (produced by `npm run pack`) next to it, then double-click it in Finder (it opens in Terminal) or run it from a shell:

```bash
chmod +x llamacpp-launcher.command   # first time only, if the executable bit was lost
./llamacpp-launcher.command
```

The script:

1. Locates or installs a supported Node.js runtime (Homebrew if available, otherwise the official build from nodejs.org) and Git (Homebrew or the Xcode Command Line Tools).
2. Installs (or updates) the packaged app into a per-user prefix under `~/.llamacpp-launcher`.
3. Starts the interactive TUI.

A log is written to `llamacpp-launcher.log` next to the `.command` file. Run `./llamacpp-launcher.command --self-test` to check the script without installing anything. On first run, choose **"No, install it for me"** to have the wizard clone and build llama.cpp with Metal, or **"Yes, I'll enter the path"** if you already built it (point it at the llama.cpp directory containing `build/bin/llama-server`).

To work on the launcher itself instead of running the packaged build, run it from a clone — see [From source](#from-source-developing-the-launcher-itself) below.

### From source (developing the launcher itself)

1. Clone the repository:

   ```bash
   git clone <repository-url>
   cd llamacpp-launcher
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Run in development mode:

   ```bash
   npm run dev
   ```

To produce a compiled build instead:

```bash
npm run build
npm start
```

`npm run build` compiles TypeScript to `dist/` (and bumps the version); `npm start` runs `node dist/index.js`. After a global install, the app is also exposed as the `llamacpp-launcher` command (see `bin` in `package.json`).

## Configuration

Defaults live in `config.default.json`. On first run, a user configuration file (`config.json`) is created in the data directory and merged over the defaults.

**Data directory resolution** (in order):

1. `LLAMACPP_LAUNCHER_HOME` environment variable, if set.
2. `%LOCALAPPDATA%\llamacpp-launcher` on Windows.
3. `~/.llamacpp-launcher` otherwise.

**Configuration keys:**

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `llamaCppDir` | string | `""` (required) | Path to the llama.cpp root. The server binary is located automatically: `build/bin/llama-server` (macOS, single-config) or `build/bin/Release/llama-server.exe` (Windows). Set by the first-run wizard (entered manually or filled in after an automated build). |
| `hfCachePath` | string | `~/.cache/huggingface/hub` | Hugging Face cache directory scanned for local GGUF models. |
| `host` | string | `0.0.0.0` | Host address passed to the server. |
| `port` | number | `8484` | Server port (1–65535). |
| `parallelSlots` | number | `1` | Number of parallel server slots. |
| `draftTokens` | number | `2` | Draft tokens for speculative decoding. |
| `cudaPdl` | `"default" \| "on" \| "off"` | `"default"` | Controls the `GGML_CUDA_PDL` environment override for CUDA PDL. `default` leaves llama.cpp behavior untouched, `on` sets `GGML_CUDA_PDL=1`, and `off` sets `GGML_CUDA_PDL=0`. |
| `contextOptions` | number[] | `[4096, 20000, 64000, 96000, 128000]` | Context-size choices offered in the UI. |

`llamaCppDir` is mandatory and is collected during first-run setup. Paths beginning with `~/` are expanded to the user's home directory.

**Sampling presets** are defined in `presets.json`. Each preset matches one or more model-name substrings and lists named profiles of sampling parameters (for example, profiles for Qwen 3.x and Gemma 4).

## Usage

Start the launcher and follow the on-screen flow.

**First run** asks four short questions: whether you already have llama.cpp compiled (or want it installed for you), the llama.cpp path or automated build, the server access mode (local-only vs. LAN), and the port.

**Each subsequent launch** proceeds through the selection flow:

1. **Model select** — choose a local GGUF model or enter a Hugging Face repository reference.
2. **Context select** — pick a context size from the configured options.
3. **Quant picker** — (Hugging Face repos only) choose a quantization file, with fit status shown.
4. **Layer select** — choose how many layers to offload to the GPU (shown when hardware and model size are known).
5. **Params select** — choose a sampling profile, edit custom parameters, enter expert raw-argument mode, or override the chat template.

Once configuration is complete, the launcher prints a summary and the resolved command line, then spawns `llama-server.exe` with stdio inherited. Press `Ctrl+C` to stop the server.

## Project structure

```text
llamacpp-launcher/
├── src/
│   ├── index.tsx              # Entry point: first-run check, selection, launch
│   ├── selection.tsx          # Orchestrates the screen flow
│   ├── launch.ts              # Spawns llama-server.exe with the built args
│   ├── config.ts              # Load/save/validate configuration
│   ├── storage.ts             # Data-directory and resource-path resolution
│   ├── types.ts               # Shared type definitions
│   ├── layout.ts, theme.ts, brand.ts
│   ├── components/            # Reusable UI components (Header, StatusBar, ...)
│   ├── hooks/                 # React hooks (useHardware, useInstaller, useModels, ...)
│   ├── screens/               # TUI screens (FirstRunSetup, InstallWizard, ModelSelect, ...)
│   ├── services/              # GGUF parsing, hardware/memory/network, installer, presets, server args
│   └── utils/                 # Formatting, HF URL parsing, platform/terminal helpers
├── scripts/                   # Build helpers (version bump, shebang, tarball rename)
├── test/                      # node:test suites (*.test.mjs)
├── config.default.json        # Default configuration
├── presets.json               # Sampling parameter presets
├── llamacpp-launcher.bat       # Windows bootstrapper / installer
├── llamacpp-launcher.command   # macOS bootstrapper / installer
├── package.json
└── tsconfig.json
```

## Contribution

1. Install dependencies with `npm install`.
2. Make changes under `src/`.
3. Run the test suite (it builds first, then runs the `node:test` files):

   ```bash
   npm test
   ```

4. Verify the build:

   ```bash
   npm run build:app
   ```

5. Open a pull request describing the change.
