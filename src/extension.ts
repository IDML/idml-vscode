'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import ReconnectingWebSocket from 'reconnecting-websocket';
import Websocket from 'ws'; 

const axios = require('axios');

export function activate(context: vscode.ExtensionContext) {
    var inputDoc: vscode.TextDocument;
    var codeDoc: vscode.TextDocument;
    var tracedDocuments = [];
    var outputDocument = "";
    var focus = "root";
    // This is ignored because I can't even figure out how to make `constuctor` happy with Websocket being passed to it
    // @ts-ignore
    const ws = new ReconnectingWebSocket("ws://localhost:8081", [], {"constructor": Websocket });
    ws.addEventListener('open', event => {
    });
    ws.addEventListener('error', event => {
    });
    ws.addEventListener('message', event => {
        const result = JSON.parse(event.data);
        if (result.out != null) {
            const json = result.out.map(x => x.result)
            outputDocument = JSON.stringify(json, null, 4)
            outputDocumentChangeEmitter.fire(outputDocumentUri);
        };
        if (result.errors != null && result.errors.length > 0) {
            const errs = result.errors
            outputDocument = JSON.stringify(errs, null, 4);
            outputDocumentChangeEmitter.fire(outputDocumentUri);
        };
        if (result.traced != null) {
            const traced = result.traced;
            tracedDocuments = traced;
            for (let i = 0; i < tracedDocuments.length; i++) {
                const uri = vscode.Uri.parse("idml-traced:"+i.toString()+".idml");
                tracedDocumentChangeEmitter.fire(uri);
            }
        };
    });

	const tracedDocumentChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    const tracedDocumentProvider = class implements vscode.TextDocumentContentProvider {
		onDidChange = tracedDocumentChangeEmitter.event;

        provideTextDocumentContent(uri: vscode.Uri): string {
            return tracedDocuments[uri.path.substring(0, uri.path.length-5)];
        }
    };
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider("idml-traced", new tracedDocumentProvider));

    const outputDocumentUri = vscode.Uri.parse("idml-result:output.json");
	const outputDocumentChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    const outputDocumentProvider = class implements vscode.TextDocumentContentProvider {
		onDidChange = outputDocumentChangeEmitter.event;

        provideTextDocumentContent(uri: vscode.Uri): string {
            return outputDocument;
        }       
    }
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider("idml-result", new outputDocumentProvider));

    function runIdml() {
        if ((inputDoc != null) && (codeDoc != null)) {
            const path = focus
            const input = JSON.parse(inputDoc.getText())
            const arrayInput = Array.isArray(input) ? input : [input]
            const msg = JSON.stringify({"in": arrayInput, "idml": codeDoc.getText(), "path": path});
            ws.send(msg);
        };
    }

    vscode.workspace.onDidChangeTextDocument(function (event) {
        if ((event.document == codeDoc) || (event.document == inputDoc)) {
            runIdml();
        };
    });

    function updateActiveState(doc: vscode.TextDocument) {
        if (doc == codeDoc) {
            vscode.workspace.getConfiguration().update("idml.activatedCode", true, null)
        } else if (doc == inputDoc) {
            vscode.workspace.getConfiguration().update("idml.activatedInput", true, null)
        } else {
            vscode.workspace.getConfiguration().update("idml.activatedCode", false, null)
            vscode.workspace.getConfiguration().update("idml.activatedInput", false, null)
        }
    }

    vscode.window.onDidChangeActiveTextEditor(function (event) {
        updateActiveState(event.document)
    });


    async function inputCommand() {
        inputDoc = vscode.window.activeTextEditor.document;
        updateActiveState(inputDoc)
        runIdml();
    }

    async function codeCommand() {
        codeDoc = vscode.window.activeTextEditor.document;
        updateActiveState(codeDoc)
        let doc = await vscode.workspace.openTextDocument(outputDocumentUri);
        await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Three});
        runIdml();
    }

    let input = vscode.commands.registerCommand('idml.input', () => inputCommand());
    let inputGrey = vscode.commands.registerCommand('idml.inputGrey', () => inputCommand());

    let code = vscode.commands.registerCommand('idml.code', () => codeCommand());
    let codeGrey = vscode.commands.registerCommand('idml.codeGrey', () => codeCommand());

    let traced = vscode.commands.registerCommand('idml.traced', async () => {
        let doc = await vscode.workspace.openTextDocument(vscode.Uri.parse("idml-traced:0.idml"));
        await vscode.window.showTextDocument(doc, { preview: false });
    });

    let setFocus = vscode.commands.registerCommand('idml.setFocus', () => {
        vscode.window.showInputBox({"value": focus, "prompt": "JSON path to focus on"}).then(s => {
            focus = s
            runIdml();
        });
    });

    context.subscriptions.push(input);
    context.subscriptions.push(inputGrey);
    context.subscriptions.push(code);
    context.subscriptions.push(codeGrey);
    context.subscriptions.push(traced);
    context.subscriptions.push(setFocus);


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


// this method is called when your extension is deactivated
export function deactivate() {
}
