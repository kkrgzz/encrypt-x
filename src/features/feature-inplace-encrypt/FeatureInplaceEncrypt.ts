import { Editor, EditorPosition, Notice, Setting, MarkdownPostProcessorContext, MarkdownView } from "obsidian";
import DecryptModal from "./DecryptModal";
import { IMeldEncryptPluginFeature } from "../IMeldEncryptPluginFeature";
import MeldEncrypt from "../../main";
import { IMeldEncryptPluginSettings } from "../../settings/MeldEncryptPluginSettings";
import { IFeatureInplaceEncryptSettings } from "./IFeatureInplaceEncryptSettings";
import PasswordModal from "./PasswordModal";
import { UiHelper } from "../../services/UiHelper";
import { SessionPasswordService } from "src/services/SessionPasswordService";
import { CryptoHelperFactory } from "src/services/CryptoHelperFactory";
import { Decryptable } from "./Decryptable";
import { FeatureInplaceTextAnalysis } from "./featureInplaceTextAnalysis";
import { _HINT, _PREFIXES, _PREFIX_ENCODE_DEFAULT, _PREFIX_ENCODE_DEFAULT_VISIBLE, _SUFFIXES, _SUFFIX_NO_COMMENT, _SUFFIX_WITH_COMMENT } from "./FeatureInplaceConstants";


export default class FeatureInplaceEncrypt implements IMeldEncryptPluginFeature{
	plugin:MeldEncrypt;
	pluginSettings: IMeldEncryptPluginSettings;
	featureSettings:IFeatureInplaceEncryptSettings;

	async onload(plugin:MeldEncrypt, settings:IMeldEncryptPluginSettings) {
		this.plugin = plugin;
		this.pluginSettings = settings;
		this.featureSettings = settings.featureInplaceEncrypt;

		this.plugin.registerMarkdownPostProcessor(
			(el,ctx) => this.processEncryptedCodeBlockProcessor(el, ctx)
		);

		plugin.addCommand({
			id: 'meld-encrypt',
			name: 'Encrypt/Decrypt',
			icon: 'lock',
			editorCheckCallback: (checking, editor, view) => this.processEncryptDecryptCommand( checking, editor, false )
		});
		
		this.plugin.addRibbonIcon(
			'file-lock',
			'Encrypt/Decrypt',
			(_) => {
				const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView == null ){
					console.debug('no active view found');
					return;
				}
				return this.processEncryptDecryptCommand(false, activeView.editor, false);
			}
		);

		plugin.addCommand({
			id: 'meld-encrypt-in-place',
			name: 'Encrypt/Decrypt In-place',
			icon: 'lock',
			editorCheckCallback: (checking, editor, view) => this.processEncryptDecryptCommand( checking, editor, true )
		});
		
	}

	onunload(){

	}

	private replaceMarkersRecursive( node: Node, rlevel: number = 0 ) : Node[] {
		
		if ( node instanceof HTMLElement ){
			for( const n of Array.from(node.childNodes) ){
				let childNodes = this.replaceMarkersRecursive( n, rlevel+1 );
				n.replaceWith( ...childNodes );
			}
			return [node];
		}

		if ( node instanceof Text ){
			
			const text = node.textContent;

			if ( text == null ){
				return [node];
			}

			if ( !text.contains( '🔐' ) ){
				return [node];
			}

			const reInplaceMatcher = /🔐(.*?)🔐/g;

			const splits = text.split( reInplaceMatcher );
			
			const nodes : Node[] = [];

			for (let i = 0; i < splits.length; i++) {
				const t = splits[i];
				if (  i % 2 != 0 ){
					// odd indexes have indicators
					const node = createSpan({
						cls: 'meld-encrypt-inline-reading-marker',
						text: '🔐',
						attr: {
							'data-meld-encrypt-encrypted' : `🔐${t}🔐`
						}
					})
					nodes.push( node );
				} else {
					nodes.push( new Text( t ) );
				}
			}

			return nodes;

		}

		return [node];
	}

	private async processEncryptedCodeBlockProcessor(el: HTMLElement, ctx: MarkdownPostProcessorContext){
		const replacementNodes = this.replaceMarkersRecursive(el);
		//console.debug( 'processEncryptedCodeBlockProcessor', { el, replacementNodes } );
		el.replaceWith( ...replacementNodes );
		// bind events
		const elIndicators = el.querySelectorAll('.meld-encrypt-inline-reading-marker');
		this.bindReadingIndicatorEventHandlers( ctx.sourcePath, elIndicators );
	}

	private bindReadingIndicatorEventHandlers( sourcePath: string, elements: NodeListOf<Element> ){
		elements.forEach( el => {
			const htmlEl = el as HTMLElement;
			if ( htmlEl == null ){
				return;
			}
			
			htmlEl.onClickEvent( async (ev) => {
				const targetEl = ev.target as HTMLElement;
				if ( targetEl == null ){
					return;
				}
				const encryptedText = targetEl.dataset['meldEncryptEncrypted'] as string;
				if ( encryptedText == null ){
					return;
				}
				const selectionAnalysis = new FeatureInplaceTextAnalysis( encryptedText );
				await this.handleReadingIndicatorClick( sourcePath, selectionAnalysis.decryptable );
			});
		} );
	}

	private async handleReadingIndicatorClick( path: string, decryptable?:Decryptable ){
		// indicator click handler
		if (decryptable == null){
			new Notice('❌ Decryption failed!');
			return;
		}

		if ( await this.showDecryptedTextIfPasswordKnown( path, decryptable ) ){
			return;
		}

		const pw = await this.fetchPasswordFromUser( decryptable.hint );

		if ( pw == null ){
			return;
		}

		// decrypt
		if ( await this.showDecryptedResultForPassword( decryptable, pw ) ){
			SessionPasswordService.putByPath(
				{
					password: pw,
					hint: decryptable.hint
				},
				path
			);
		}else{
			new Notice('❌ Decryption failed!');
		}

	}
	
	private async showDecryptedResultForPassword( decryptable: Decryptable, pw:string ): Promise<boolean> {
		const crypto =  CryptoHelperFactory.BuildFromDecryptableOrThrow( decryptable );

		const decryptedText = await crypto.decryptFromBase64( decryptable.base64CipherText, pw );

		// show result
		if (decryptedText === null) {
			return false;
		}
		
		return new Promise<boolean>( (resolve) => {
			const decryptModal = new DecryptModal(this.plugin.app, '🔓', decryptedText );
			decryptModal.canDecryptInPlace = false;
			decryptModal.onClose = () =>{
				resolve(true);
			}
			decryptModal.open();
		} )
			
			
	}

	private async fetchPasswordFromUser( hint:string ): Promise<string|null|undefined> {
		// fetch password
		return new Promise<string|null|undefined>( (resolve) => {
			const pwModal = new PasswordModal(
				this.plugin.app,
				/*isEncrypting*/ false,
				/*confirmPassword*/ false,
				/*defaultShowInReadingView*/ this.featureSettings.showMarkerWhenReadingDefault,
				'',
				hint
			);

			pwModal.onClose = () =>{
				resolve( pwModal.resultPassword );
			}

			pwModal.open();


		} );
	}

	private async showDecryptedTextIfPasswordKnown( filePath: string, decryptable: Decryptable ) : Promise<boolean> {
		const bestGuessPasswordAndHint = SessionPasswordService.getByPath( filePath );
		if ( bestGuessPasswordAndHint.password == null ){
			return false;
		}

		return await this.showDecryptedResultForPassword(
			decryptable,
			bestGuessPasswordAndHint.password
		);
	}

	public buildSettingsUi(
		containerEl: HTMLElement,
		saveSettingCallback : () => Promise<void>
	): void {
		new Setting(containerEl)
			.setHeading()
			.setName('In-place encryption')
		;

		// Selection encrypt feature settings below
		new Setting(containerEl)
			.setName('Expand selection to whole line?')
			.setDesc('Partial selections will get expanded to the whole line.')
			.addToggle( toggle =>{
				toggle
					.setValue(this.featureSettings.expandToWholeLines)
					.onChange( async value =>{
						this.featureSettings.expandToWholeLines = value;
						await saveSettingCallback();
					})
			})
		;

		new Setting(containerEl)
			.setName('By default, show encrypted marker when reading')
			.setDesc('When encrypting inline text, should the default be to have a visible marker in Reading view?')
			.addToggle( toggle =>{
				toggle
					.setValue(this.featureSettings.showMarkerWhenReadingDefault)
					.onChange( async value =>{
						this.featureSettings.showMarkerWhenReadingDefault = value;
						await saveSettingCallback();
					})
			})
		;
	}

	private processEncryptDecryptCommand(
		checking: boolean,
		editor: Editor,
		decryptInPlace: boolean
	): boolean {
		if ( checking && UiHelper.isSettingsModalOpen() ){
			// Settings is open, ensures this command can show up in other
			// plugins which list commands e.g. customizable-sidebar
			return true;
		}

		let startPos = editor.getCursor('from');
		let endPos = editor.getCursor('to');

		if (this.featureSettings.expandToWholeLines){
			const startLine = startPos.line;
			startPos = { line: startLine, ch: 0 }; // want the start of the first line

			const endLine = endPos.line;
			const endLineText = editor.getLine(endLine);
			endPos = { line: endLine, ch: endLineText.length }; // want the end of last line
		}else{
			if ( !editor.somethingSelected() ){
				// nothing selected, first assume user wants to decrypt, expand to start and end markers...
				// but if no markers found then prompt to encrypt text
				const foundStartPos = this.getClosestPrefixCursorPos( editor );
				const foundEndPos = this.getClosestSuffixCursorPos(editor);

				if (
					foundStartPos == null
					|| foundEndPos == null
					|| ( startPos.line < foundStartPos.line )
					|| ( endPos.line > foundEndPos.line )
				){
					// selection is empty, prompt for text to encrypt
					return this.promptForTextToEncrypt(
						checking,
						editor,
						startPos
					);
				}

				startPos = foundStartPos;
				endPos = foundEndPos;
			}
		}

		// Encrypt or Decrypt selected text
		const selectionText = editor.getRange(startPos, endPos);

		return this.processSelection(
			checking,
			editor,
			selectionText,
			startPos,
			endPos,
			decryptInPlace
		);
	}

	private promptForTextToEncrypt(
		checking: boolean,
		editor: Editor,
		pos: CodeMirror.Position
	) : boolean {

		// show dialog with password, confirmation, hint and text
		// insert into editor at pos

		const activeFile = this.plugin.app.workspace.getActiveFile();
		if (activeFile == null){
			return false;
		}
		
		if (checking) {
			return true;
		}

		// Fetch password from user

		// determine default password and hint
		let defaultPassword = '';
		let defaultHint = '';
		if ( this.pluginSettings.rememberPassword ){
			const bestGuessPasswordAndHint = SessionPasswordService.getByPath( activeFile.path );
			//console.debug({bestGuessPasswordAndHint});

			defaultPassword = bestGuessPasswordAndHint.password;
			defaultHint = bestGuessPasswordAndHint.hint;
		}

		const confirmPassword = this.pluginSettings.confirmPassword;

		const pwModal = new PasswordModal(
			this.plugin.app,
			true,
			confirmPassword,
			/*defaultShowInReadingView*/ this.featureSettings.showMarkerWhenReadingDefault,
			defaultPassword,
			defaultHint,
			/*showTextToEncrypt*/ true
		);
		pwModal.onClose = async () => {
			if ( !pwModal.resultConfirmed ){
				return;
			}
			const pw = pwModal.resultPassword ?? ''
			const hint = pwModal.resultHint ?? '';
			const textToEncrypt = pwModal.resultTextToEncrypt ?? '';

			const encryptable = new Encryptable();
			encryptable.text = textToEncrypt;
			encryptable.hint = hint;

			this.encryptSelection(
				editor,
				encryptable,
				pw,
				pos,
				pos,
				pwModal.resultShowInReadingView ?? this.featureSettings.showMarkerWhenReadingDefault
			);

			// remember password
			SessionPasswordService.putByPath( { password:pw, hint: hint }, activeFile.path );
		}
		pwModal.open();

		return false;
	}

	private getClosestPrefixCursorPos(editor: Editor): EditorPosition | null{
		
		const maxLengthPrefix = _PREFIXES.reduce((prev,cur, i) => {
			if (i== 0) return cur;
			if ( cur.length > prev.length ) return cur;
			return prev;
		} );
		const initOffset = editor.posToOffset( editor.getCursor("from") ) + maxLengthPrefix.length;

		for (let offset = initOffset; offset >= 0; offset--) {
			const offsetPos = editor.offsetToPos(offset);
			for (const prefix of _PREFIXES) {
				const prefixStartOffset = offset - prefix.length;
				const prefixStartPos = editor.offsetToPos(prefixStartOffset);
			
				const testText = editor.getRange( prefixStartPos, offsetPos );
				//console.debug({testText});
				if (testText == prefix){
					return editor.offsetToPos(prefixStartOffset);
				}
			}
		}

		return null;

	}

	private getClosestSuffixCursorPos(editor: Editor): EditorPosition | null{
		const maxLengthPrefix = _PREFIXES.reduce((prev,cur, i) => {
			if (i== 0) return cur;
			if ( cur.length > prev.length ) return cur;
			return prev;
		} );
		
		const initOffset = editor.posToOffset( editor.getCursor("from") ) - maxLengthPrefix.length + 1;
		const lastLineNum = editor.lastLine();

		const maxOffset = editor.posToOffset( {line:lastLineNum, ch:editor.getLine(lastLineNum).length} );

		for (let offset = initOffset; offset <= maxOffset; offset++) {
			const offsetPos = editor.offsetToPos(offset);
			for (const suffix of _SUFFIXES) {	
				const textEndOffset = offset + suffix.length;
				const textEndPos = editor.offsetToPos(textEndOffset);
				
				const testText = editor.getRange( offsetPos, textEndPos );
				
				if (testText == suffix){
					return textEndPos;
				}
			}
		}
		
		return null;
	}

	private processSelection(
		checking: boolean,
		editor: Editor,
		selectionText: string,
		finalSelectionStart: CodeMirror.Position,
		finalSelectionEnd: CodeMirror.Position,
		decryptInPlace: boolean,
		allowEncryption = true
	) : boolean {
		const selectionAnalysis = new FeatureInplaceTextAnalysis( selectionText );
		//console.debug(selectionAnalysis);

		if (selectionAnalysis.isEmpty) {
			if (!checking){
				new Notice('Nothing to Encrypt.');
			}
			return false;
		}

		if (!selectionAnalysis.canDecrypt && !selectionAnalysis.canEncrypt) {
			if (!checking){
				new Notice('Unable to Encrypt or Decrypt that.');
			}
			return false;
		}

		if (selectionAnalysis.canEncrypt && !allowEncryption){
			return false;
		}

		const activeFile = this.plugin.app.workspace.getActiveFile();
		if (activeFile == null){
			return false;
		}

		if (checking) {
			return true;
		}

		
		// Fetch password from user

		// determine default password and hint
		let defaultPassword = '';
		let defaultHint = selectionAnalysis.decryptable?.hint;
		if ( this.pluginSettings.rememberPassword ){
			const bestGuessPasswordAndHint = SessionPasswordService.getByPath( activeFile.path );
			//console.debug({bestGuessPasswordAndHint});

			defaultPassword = bestGuessPasswordAndHint.password;
			defaultHint = defaultHint ?? bestGuessPasswordAndHint.hint;
		}

		const confirmPassword = selectionAnalysis.canEncrypt && this.pluginSettings.confirmPassword;

		const pwModal = new PasswordModal(
			this.plugin.app,
			selectionAnalysis.canEncrypt,
			confirmPassword,
			/*defaultShowInReadingView*/ this.featureSettings.showMarkerWhenReadingDefault,
			defaultPassword,
			defaultHint
		);

		pwModal.onClose = async () => {
			if ( !pwModal.resultConfirmed ){
				return;
			}
			const pw = pwModal.resultPassword ?? ''
			const hint = pwModal.resultHint ?? '';

			if (selectionAnalysis.canEncrypt) {

				const encryptable = new Encryptable();
				encryptable.text = selectionText;
				encryptable.hint = hint;

				this.encryptSelection(
					editor,
					encryptable,
					pw,
					finalSelectionStart,
					finalSelectionEnd,
					pwModal.resultShowInReadingView ?? this.featureSettings.showMarkerWhenReadingDefault
				);

				// remember password
				SessionPasswordService.putByPath( { password:pw, hint: hint }, activeFile.path );

			} else if ( selectionAnalysis.decryptable ) {

				const decryptSuccess = await this.decryptSelection(
					editor,
					selectionAnalysis.decryptable,
					pw,
					finalSelectionStart,
					finalSelectionEnd,
					decryptInPlace
				);

				// remember password?
				if ( decryptSuccess ) {
					SessionPasswordService.putByPath( { password:pw, hint: hint }, activeFile.path );
				}
				
			}
		}
		pwModal.open();

		return true;
	}

	private async encryptSelection(
		editor: Editor,
		encryptable: Encryptable,
		password: string,
		finalSelectionStart: CodeMirror.Position,
		finalSelectionEnd: CodeMirror.Position,
		showInReadingView: boolean
	) {
		//encrypt
		const crypto = CryptoHelperFactory.BuildDefault();
		const encodedText = this.encodeEncryption(
			await crypto.encryptToBase64(encryptable.text, password),
			encryptable.hint,
			showInReadingView
		);
		editor.setSelection(finalSelectionStart, finalSelectionEnd);
		editor.replaceSelection(encodedText);
	}

	private async decryptSelection(
		editor: Editor,
		decryptable: Decryptable,
		password: string,
		selectionStart: CodeMirror.Position,
		selectionEnd: CodeMirror.Position,
		decryptInPlace: boolean
	) : Promise<boolean> {

		// decrypt

		const crypto = CryptoHelperFactory.BuildFromDecryptableOrThrow(decryptable);
		const decryptedText = await crypto.decryptFromBase64(decryptable.base64CipherText, password);
		if (decryptedText === null) {
			new Notice('❌ Decryption failed!');
			return false;
		} else {

			if (decryptInPlace) {
				editor.setSelection(selectionStart, selectionEnd);
				editor.replaceSelection(decryptedText);
			} else {
				const decryptModal = new DecryptModal(this.plugin.app, '🔓', decryptedText );
				decryptModal.onClose = async () => {
					editor.focus();
					if (decryptModal.decryptInPlace) {
						editor.setSelection(selectionStart, selectionEnd);
						editor.replaceSelection(decryptModal.text);
					} else if (decryptModal.save) {
						const crypto = CryptoHelperFactory.BuildDefault();
						const encodedText = this.encodeEncryption(
							await crypto.encryptToBase64(decryptModal.text, password),
							decryptable.hint ?? "",
							decryptable.showInReadingView
						);
						editor.setSelection(selectionStart, selectionEnd);
						editor.replaceSelection(encodedText);
					}
				}
				decryptModal.open();
			}
		}
		return true;
	}

	private encodeEncryption( encryptedText: string, hint: string, showInReadingView: boolean ): string {
		if (
			!_PREFIXES.some( (prefix) => encryptedText.includes(prefix) )
			&& !_SUFFIXES.some( (suffix) => encryptedText.includes(suffix) )
		) {
			const prefix = showInReadingView ? _PREFIX_ENCODE_DEFAULT_VISIBLE : _PREFIX_ENCODE_DEFAULT;
			const suffix = showInReadingView ? _SUFFIX_NO_COMMENT : _SUFFIX_WITH_COMMENT;

			if ( hint.length > 0 ){
				return prefix.concat(_HINT, hint, _HINT, encryptedText, suffix);
			}
			return prefix.concat(encryptedText, suffix);
		}
		return encryptedText;
	}
}

class Encryptable{
	text:string;
	hint:string;
}
