import type { AttachmentKind } from './AttachmentKind';
import type { AttachmentType } from './AttachmentType';

export type Attachment = {
	url: string;
	kind: AttachmentKind;
	type: AttachmentType;
	label?: string;
};
