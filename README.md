# Cognitive Complexity

A VS Code extension that displays the cognitive complexity of JavaScript/TypeScript/Apex code in your status bar.

## Features

- **Real-time complexity scoring** - Shows cognitive complexity score in status bar
- **Visual complexity indicators** - Dots indicate complexity levels (1-4 dots for increasing complexity)
- **Inline hints** - Click the status bar to toggle detailed complexity hints showing exactly what contributes to complexity
- **Color-coded hints** - Blue for low impact (+1), yellow for moderate (+2-3), red for high impact (+4+)

Supports JavaScript, TypeScript, JSX, TSX, and Apex files.

## Usage

The extension automatically activates when you open JS/TS/Apex files. The status bar shows `CC X` where X is the complexity score, followed by visual indicators for complexity level.

Click the complexity indicator to toggle inline hints that show exactly which lines contribute to complexity and by how much.

## Complexity Scoring

Based on cognitive complexity principles - counts decision points with nesting penalties for deeply nested code structures.