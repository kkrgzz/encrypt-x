import { Notice, Plugin } from 'obsidian';
import MeldEncryptSettingsTab from './settings/MeldEncryptSettingsTab';
import { IMeldEncryptPluginSettings } from './settings/MeldEncryptPluginSettings';
import { IMeldEncryptPluginFeature } from './features/IMeldEncryptPluginFeature';
import { SessionPasswordService } from './services/SessionPasswordService';
import FeatureInplaceEncrypt from './features/feature-inplace-encrypt/FeatureInplaceEncrypt';
import FeatureWholeNoteEncrypt from './features/feature-whole-note-encrypt/FeatureWholeNoteEncrypt';
import { EditViewEnum } from './features/feature-whole-note-encrypt/EncryptedFileContentView';
import FeatureConvertNote from './features/feature-convert-note/FeatureConvertNote';
import { CryptoHelperFactory } from './services/CryptoHelperFactory';
import { VIEW_TYPE_ENCRYPTED_FILE_CONTENT } from './features/feature-whole-note-encrypt/EncryptedFileContentView';

export default class MeldEncrypt extends Plugin {

	private settings: IMeldEncryptPluginSettings;
	private enabledFeatures : IMeldEncryptPluginFeature[] = [];

	async onload() {
		
		// Settings
		await this.loadSettings();

		CryptoHelperFactory.initialize(this);

		this.enabledFeatures.push(
			new FeatureWholeNoteEncrypt(),
			new FeatureConvertNote(),
			new FeatureInplaceEncrypt(),
		);

		this.addSettingTab(
			new MeldEncryptSettingsTab(
				this.app,
				this,
				this.settings,
				this.enabledFeatures
			)
		);
		// End Settings

		this.addCommand({
			id: 'meld-encrypt-clear-password-cache',
			name: 'Clear Session Password Cache',
			icon: 'file-lock',
			callback: () => {
				this.app.workspace.detachLeavesOfType(VIEW_TYPE_ENCRYPTED_FILE_CONTENT);
				const itemsCleared = SessionPasswordService.clear();
				new Notice( `Items cleared: ${itemsCleared}` );
			},
		});

		// load features
		this.enabledFeatures.forEach(async f => {
			await f.onload( this, this.settings );
		});

	}
	
	onunload() {
		this.enabledFeatures.forEach(async f => {
			f.onunload();
		});
	}

	async loadSettings() {
		
		const DEFAULT_SETTINGS: IMeldEncryptPluginSettings = {
			confirmPassword: true,
			rememberPassword: true,
			rememberPasswordTimeout: 30,
			rememberPasswordLevel: SessionPasswordService.LevelVault,

			featureWholeNoteEncrypt: {
				defaultView: EditViewEnum.source.toString()
			},
			
			featureInplaceEncrypt:{
				expandToWholeLines: false,
				showMarkerWhenReadingDefault: true
			},

            vectorSize: 16,
            saltSize: 16,
            iterations: 600000
		}

		this.settings = Object.assign(
			DEFAULT_SETTINGS,
			await this.loadData()
		);

		// apply settings
		SessionPasswordService.setActive( this.settings.rememberPassword );
		SessionPasswordService.setAutoExpire(
			this.settings.rememberPasswordTimeout == 0
			? null
			: this.settings.rememberPasswordTimeout
		);
		SessionPasswordService.setLevel( this.settings.rememberPasswordLevel );
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

}