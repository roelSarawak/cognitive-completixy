import * as vscode from 'vscode';
import { calculateCognitiveComplexity, analyzeCognitiveComplexity, findMethodBoundaries, ComplexityContribution } from './complexity';

const SUPPORTED_LANGUAGES = ['javascript', 'typescript', 'javascriptreact', 'typescriptreact', 'apex'];

let statusBarItem: vscode.StatusBarItem;
let timeout: NodeJS.Timeout | undefined;
let hintsVisible = false;
let infoDecorationType: vscode.TextEditorDecorationType;
let warningDecorationType: vscode.TextEditorDecorationType;
let errorDecorationType: vscode.TextEditorDecorationType;

const codeLensEmitter = new vscode.EventEmitter<void>();

// Each lens carries its own method body so scoring (analyzeCognitiveComplexity)
// happens lazily in resolveCodeLens, per-lens, instead of all at once up front.
class MethodCodeLens extends vscode.CodeLens {
  constructor(range: vscode.Range, public body: string, public name: string) {
    super(range);
  }
}

const codeLensProvider: vscode.CodeLensProvider = {
  onDidChangeCodeLenses: codeLensEmitter.event,
  provideCodeLenses(document) {
    if (!isSupportedLanguage(document.languageId)) return [];
    return findMethodBoundaries(document.getText()).map(
      method => new MethodCodeLens(new vscode.Range(method.line, 0, method.line, 0), method.body, method.name)
    );
  },
  resolveCodeLens(codeLens) {
    if (codeLens instanceof MethodCodeLens) {
      const complexity = analyzeCognitiveComplexity(codeLens.body, codeLens.name).totalComplexity;
      codeLens.command = { title: `Cognitive Complexity: ${complexity}`, command: 'cognitiveComplexity.refresh' };
    }
    return codeLens;
  }
};

export function activate(context: vscode.ExtensionContext) {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'cognitiveComplexity.refresh';
  context.subscriptions.push(statusBarItem);

  // Create decoration types
  infoDecorationType = vscode.window.createTextEditorDecorationType({
    after: {
      color: '#17a2b8',
      fontStyle: 'italic',
      margin: '0 0 0 1em'
    }
  });

  warningDecorationType = vscode.window.createTextEditorDecorationType({
    after: {
      color: '#ffc107',
      fontStyle: 'italic',
      margin: '0 0 0 1em'
    }
  });

  errorDecorationType = vscode.window.createTextEditorDecorationType({
    after: {
      color: '#dc3545',
      fontStyle: 'italic',
      margin: '0 0 0 1em'
    }
  });

  context.subscriptions.push(infoDecorationType, warningDecorationType, errorDecorationType);

  context.subscriptions.push(vscode.languages.registerCodeLensProvider(SUPPORTED_LANGUAGES, codeLensProvider));

  const refreshCommand = vscode.commands.registerCommand('cognitiveComplexity.refresh', toggleHints);
  context.subscriptions.push(refreshCommand);

  const onActiveEditorChange = vscode.window.onDidChangeActiveTextEditor(() => {
    hideHints();
    updateComplexity();
  });
  context.subscriptions.push(onActiveEditorChange);

  const onDocumentChange = vscode.workspace.onDidChangeTextDocument(debounceUpdate);
  context.subscriptions.push(onDocumentChange);

  updateComplexity();
}

function debounceUpdate() {
  if (timeout) clearTimeout(timeout);
  timeout = setTimeout(updateComplexity, 300);
}

function updateComplexity() {
  const editor = vscode.window.activeTextEditor;
  
  if (!editor || !isSupportedLanguage(editor.document.languageId)) {
    statusBarItem.hide();
    return;
  }

  const complexity = calculateCognitiveComplexity(editor.document.getText());
  const level = getComplexityLevel(complexity);
  
  statusBarItem.text = `CC ${complexity} ${level}`;
  statusBarItem.color = undefined;
  statusBarItem.tooltip = `Cognitive Complexity: ${complexity} - ${level}`;
  statusBarItem.show();

  codeLensEmitter.fire();
}

function isSupportedLanguage(languageId: string): boolean {
  return SUPPORTED_LANGUAGES.includes(languageId);
}

function getComplexityLevel(complexity: number): string {
  const icon = '$(circle-large-filled)';
  if (complexity <= 5) return '';
  if (complexity <= 10) return icon;
  if (complexity <= 20) return icon.repeat(2);
  if (complexity <= 50) return icon.repeat(3);
  return icon.repeat(4);
}

function toggleHints() {
  if (hintsVisible) {
    hideHints();
  } else {
    showHints();
  }
}

function showHints() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isSupportedLanguage(editor.document.languageId)) {
    return;
  }

  const analysis = analyzeCognitiveComplexity(editor.document.getText());
  const infoDecorations: vscode.DecorationOptions[] = [];
  const warningDecorations: vscode.DecorationOptions[] = [];
  const errorDecorations: vscode.DecorationOptions[] = [];

  // Group contributions by line
  const contributionsByLine = new Map<number, ComplexityContribution[]>();
  for (const contribution of analysis.contributions) {
    if (!contributionsByLine.has(contribution.line)) {
      contributionsByLine.set(contribution.line, []);
    }
    contributionsByLine.get(contribution.line)!.push(contribution);
  }

  for (const [lineNum, contributions] of contributionsByLine) {
    const lineText = editor.document.lineAt(lineNum).text;
    const lineEnd = lineText.length;
    
    const range = new vscode.Range(lineNum, lineEnd, lineNum, lineEnd);
    
    // Format multiple contributions with commas
    const descriptions = contributions.map(c => c.description);
    const contentText = descriptions.length > 1 
      ? ` ${descriptions.join(', ')}`
      : ` ${descriptions[0]}`;

    const decoration: vscode.DecorationOptions = {
      range,
      renderOptions: {
        after: {
          contentText
        }
      }
    };

    // Use the highest contribution level for the decoration color
    const maxContribution = Math.max(...contributions.map(c => c.contribution));
    if (maxContribution === 1) {
      infoDecorations.push(decoration);
    } else if (maxContribution <= 3) {
      warningDecorations.push(decoration);
    } else {
      errorDecorations.push(decoration);
    }
  }

  editor.setDecorations(infoDecorationType, infoDecorations);
  editor.setDecorations(warningDecorationType, warningDecorations);
  editor.setDecorations(errorDecorationType, errorDecorations);
  hintsVisible = true;
}

function hideHints() {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    editor.setDecorations(infoDecorationType, []);
    editor.setDecorations(warningDecorationType, []);
    editor.setDecorations(errorDecorationType, []);
  }
  hintsVisible = false;
}

export function deactivate() {
  if (timeout) clearTimeout(timeout);
}