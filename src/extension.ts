'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

const axios = require('axios');

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    var panel;
    var inputDoc;
    var codeDoc;
    var tracedDocuments = [];

	const onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    const tracedDocumentProvider = class implements vscode.TextDocumentContentProvider {

        // emitter and its event
		onDidChange = onDidChangeEmitter.event;

        provideTextDocumentContent(uri: vscode.Uri): string {
            vscode.window.showInformationMessage("document provider called");
            return tracedDocuments[uri.path.substring(0, uri.path.length-5)];
        }
      };

    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider("idml-traced", new tracedDocumentProvider));


    vscode.workspace.onDidChangeTextDocument(function (event) {
        if (event.document === inputDoc) {
            panel.webview.postMessage({command: "input", data: inputDoc.getText() });
            panel.webview.postMessage({command: "run"});
        }
        if (event.document === codeDoc) {
            panel.webview.postMessage({command: "code", data: codeDoc.getText() });
            panel.webview.postMessage({command: "run"});
        }
    });

    let run = vscode.commands.registerCommand('idml.run', () => {
        panel = vscode.window.createWebviewPanel(
            'idmld',
            "IDMLd Runner",
            vscode.ViewColumn.Three,
            { enableScripts: true }
        );
        panel.webview.html = getWebviewContent();
        panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'traced-result':
                        tracedDocuments = message.result;
                        vscode.window.showInformationMessage("updated trace details");
                        for (let i = 0; i < tracedDocuments.length; i++) {
                            const uri = vscode.Uri.parse("idml-traced:"+i.toString()+".idml");
                            vscode.window.showInformationMessage("firing update for "+uri.toString())
                            onDidChangeEmitter.fire(uri);
                            console.log ("Block statement execution no." + i);
                        }
                        return;
                }
            },
            undefined,
            context.subscriptions
          );
    });

    let input = vscode.commands.registerCommand('idml.input', () => {
        inputDoc = vscode.window.activeTextEditor.document;
        panel.webview.postMessage({command: "input", data: vscode.window.activeTextEditor.document.getText() });
        panel.webview.postMessage({command: "run"});
    });

    let code = vscode.commands.registerCommand('idml.code', () => {
        codeDoc = vscode.window.activeTextEditor.document;
        panel.webview.postMessage({command: "code", data: vscode.window.activeTextEditor.document.getText()});
        panel.webview.postMessage({command: "run"});
    });

    let traced = vscode.commands.registerCommand('idml.traced', async () => {
        panel.webview.postMessage({command: "traced"});
        let doc = await vscode.workspace.openTextDocument(vscode.Uri.parse("idml-traced:0.idml"));
        await vscode.window.showTextDocument(doc, { preview: false });
    });

    context.subscriptions.push(run);
    context.subscriptions.push(input);
    context.subscriptions.push(code);
    context.subscriptions.push(traced);


    // and completion
    let sel:vscode.DocumentSelector = { scheme: 'file', language: 'idml' };

    let functionProvider:vscode.CompletionItemProvider = {
		provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
            return axios.get("http://localhost:8081/functions/").then((fs: HttpResponse<Functions>) => {
                return fs.data.map((f: Function) => {
                        const ci = new vscode.CompletionItem(f.name, vscode.CompletionItemKind.Function);
                        ci.detail = f.description;
                        ci.documentation = f.description;
                        ci.insertText = f.name+"(";
                        ci.sortText = "2" + f.name; // sort functions below attributes
                        return ci;
                    }
                );
            });
        }
    };

    let dataProvider: vscode.CompletionItemProvider = {
        provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
            const offset = document.offsetAt(position);
            const input = JSON.parse(inputDoc.getText());
            const req: CompletionRequest = {
                idml: codeDoc.getText(),
                in: input instanceof Array ? input : [input],
                position: offset
            };
            console.log(req);
            return axios.post("http://localhost:8081/completion", req).then((cs: HttpResponse<Array<string>>) => {
                return cs.data.map((f: string) => {
                    const ci = new vscode.CompletionItem(f, vscode.CompletionItemKind.Property);
                    ci.sortText = "1" + f; // sort attributes above functions
                    return ci;
                });
            }
            );
        }
    };

    let lang = vscode.languages.registerCompletionItemProvider(sel, functionProvider, ".");
    let data = vscode.languages.registerCompletionItemProvider(sel, dataProvider, ".")
    context.subscriptions.push(lang);
    context.subscriptions.push(data);
}

interface CompletionRequest {
    in: Array<JSON>,
    idml: string,
    position: number
}

interface Function {
    name: string, description: string, arguments: Array<Array<string>>;
}

interface Functions extends Array<Function>{}

interface HttpResponse<T> {
    data: T;
}

function getWebviewContent() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="notviewport" content="width=device-width, initial-scale=1.0">
    <title>IDML Debug Server</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/reconnecting-websocket/1.0.0/reconnecting-websocket.min.js"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/9.12.0/styles/zenburn.min.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/9.12.0/highlight.min.js"></script>
    <script>hljs.initHighlightingOnLoad();</script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/hack/0.8.1/hack.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/hack/0.8.1/dark-grey.css">
</head>
<body class="hack dark-grey">
    <div class="main container">
        <h1>IDML daemon</h1>
        <ul><li id="status"></li></ul>

        <form class="form">
            <fieldset class="form-group">
                <h2>Path</h2>
                <input id="path" type="text" class="form-control" placeholder="root">
            </fieldset>
        </form>
        <h2>results</h2>
        <pre><code class="json" id="result"></code></pre>
        <h2>errors</h2>
        <pre id="errors"></pre>
    </div>

    <script>

    const vscode = acquireVsCodeApi();
    var input = [];
    var code = "";
    var path = "root";
    var traced = [];
    const result = document.getElementById('result');
    const errors = document.getElementById('errors');
    const status = document.getElementById('status');
    const pathElem = document.getElementById("path");
    pathElem.oninput = (event) => {
        path = pathElem.value;
        if (pathElem.value=="") {
            path = "root";
        } else {
            path = pathElem.value
        }
        console.log(JSON.stringify({"in": input, "idml": code, "path": path}));
        backend.send(JSON.stringify({"in": input, "idml": code, "path": path}));
    };


    var backend = new ReconnectingWebSocket("ws://localhost:8081/");
    backend.onmessage = function (event) {
        const e = JSON.parse(event.data);
        if (e.out == null) {
            result.textContent = "null";
        } else {
            result.textContent = JSON.stringify(e.out.map(x => x.result), null, 2);
            traced = e.traced;
            vscode.postMessage({"command": "traced-result", "result": traced});
        }
        errors.textContent = e.errors;
        hljs.highlightBlock(result);
    };
    backend.onopen = function (event) {
        status.textContent = "connected";
    }
    backend.onclose = function (event) {
        status.textContent = "disconnected";
    }

    result.textContent = "loaded";

    // Handle the message inside the webview
    window.addEventListener('message', event => {

        const message = event.data; // The JSON data our extension sent

        switch (message.command) {
            case 'input':
                var i = JSON.parse(message.data);
		if (!Array.isArray(i)) {
                    input = [i];
		} else {
		    input = i;
		}
                break;
            case 'code':
                code = message.data;
                break;
            case 'run':
                console.log(JSON.stringify({"in": input, "idml": code, "path": path}));
                backend.send(JSON.stringify({"in": input, "idml": code, "path": path}));
            case 'traced':
                vscode.postMessage({"command": "traced-result", "result": traced});
                
        }
    });
</script>

</body>
</html>`;
}

// this method is called when your extension is deactivated
export function deactivate() {
}
