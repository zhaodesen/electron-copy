# Copy App

A Windows desktop snippet manager with fast search, global shortcuts, and one-click clipboard access.

[English](./README.md) | [简体中文](./README.zh-CN.md)

## Features

- Save, edit, search, and delete reusable text snippets
- Copy any saved item back to the clipboard with one click
- Open a full-screen search overlay with a configurable global shortcut
- Capture selected text through a Windows UI Automation helper
- Keep frequently used entries easy to reach
- Store data locally and update the app through GitHub Releases

## Tech Stack

Electron · React 19 · Vite · SQLite/local storage layer · .NET UI Automation helper · electron-builder

## Requirements

- Windows x64
- Node.js and npm
- .NET SDK when rebuilding the UI Automation helper

## Getting Started

```bash
npm install
npm run dev
```

If the C# UI Automation helper changed, publish it before starting Electron:

```bash
npm run dev:with-publish
```

## Build and Release

| Command | Description |
| --- | --- |
| `npm run build` | Build the renderer |
| `npm run build:uia` | Publish the Windows UI Automation helper |
| `npm run dist:local` | Create an installer without publishing |
| `npm run dist` | Build and publish with electron-builder |

GitHub Actions can build on pushes and publish release artifacts from version tags. Configure signing and publishing credentials as repository secrets rather than committing them.

## How It Works

```text
React renderer
  ↕ secure preload IPC
Electron main process
  ├── local snippet storage
  ├── clipboard and global shortcuts
  ├── search overlay
  └── Windows UI Automation helper
```

## License

ISC
