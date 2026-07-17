# Copy App

一个支持快速搜索、全局快捷键和一键复制的 Windows 桌面文本片段管理工具。

[English](./README.md) | [简体中文](./README.zh-CN.md)

## 主要功能

- 保存、编辑、搜索和删除常用文本片段
- 一键将已保存内容复制回剪贴板
- 通过可配置的全局快捷键打开全屏搜索浮层
- 使用 Windows UI Automation 辅助程序捕获当前选中文本
- 让高频使用的内容更容易访问
- 数据保存在本地，并通过 GitHub Releases 更新应用

## 技术栈

Electron · React 19 · Vite · SQLite/本地存储层 · .NET UI Automation Helper · electron-builder

## 环境要求

- Windows x64
- Node.js 与 npm
- 重新构建 UI Automation Helper 时需要 .NET SDK

## 快速开始

```bash
npm install
npm run dev
```

如果 C# UI Automation Helper 有修改，请先发布辅助程序再启动 Electron：

```bash
npm run dev:with-publish
```

## 构建与发布

| 命令 | 说明 |
| --- | --- |
| `npm run build` | 构建渲染进程 |
| `npm run build:uia` | 发布 Windows UI Automation Helper |
| `npm run dist:local` | 生成安装包但不发布 |
| `npm run dist` | 使用 electron-builder 构建并发布 |

GitHub Actions 可在推送代码时构建，并通过版本 Tag 发布产物。签名和发布凭据应配置为仓库 Secrets，不要提交到代码库。

## 工作原理

```text
React 渲染进程
  ↕ 安全的 preload IPC
Electron 主进程
  ├── 本地文本片段存储
  ├── 剪贴板与全局快捷键
  ├── 搜索浮层
  └── Windows UI Automation Helper
```

## 许可证

ISC
