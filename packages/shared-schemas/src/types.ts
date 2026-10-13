/** Independently authored product contract. Reference observations never define authority. */
export type LocalizedText = Readonly<{ bn: string; en: string }>;
export type EvidenceStatus =
  | "observed"
  | "inferred"
  | "proposed"
  | "unverified";
export type Predicate =
  | Readonly<{ field: string; equals: string | number | boolean }>
  | Readonly<{ field: string; present: boolean }>
  | Readonly<{ all: readonly Predicate[] }>
  | Readonly<{ any: readonly Predicate[] }>;

export interface FieldConstraints {
  readonly required?: boolean;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly min?: number;
  readonly max?: number;
  readonly pattern?: string;
  readonly minRows?: number;
  readonly maxRows?: number;
  readonly acceptedMimeTypes?: readonly string[];
  readonly maxBytes?: number;
  readonly mustBeTrue?: boolean;
  readonly integer?: boolean;
  /** Compare within the same object/repeatable row, never another tenant's data. */
  readonly differentFrom?: string;
  readonly uniqueBy?: string;
}
export interface FieldDefinition {
  readonly id: string;
  readonly type:
    | "text"
    | "textarea"
    | "number"
    | "date"
    | "select"
    | "checkbox"
    | "attachment"
    | "repeatable";
  readonly label: LocalizedText;
  readonly description?: LocalizedText;
  readonly constraints?: FieldConstraints;
  readonly options?: readonly Readonly<{
    value: string;
    label: LocalizedText;
  }>[];
  readonly visibleWhen?: Predicate;
  readonly requiredWhen?: Predicate;
  readonly children?: readonly FieldDefinition[];
  readonly evidence?: Readonly<{
    status: EvidenceStatus;
    fieldNames?: readonly string[];
    source?: string;
  }>;
}
export interface FormSection {
  readonly id: string;
  readonly title: LocalizedText;
  readonly fields: readonly FieldDefinition[];
}
export interface FormSchema {
  readonly serviceNo: number;
  readonly version: number;
  readonly title: LocalizedText;
  readonly stage: "operational_demo" | "catalog_preview";
  readonly sections: readonly FormSection[];
  readonly evidence: Readonly<{
    status: "proposed";
    source: string;
    limitation: string;
  }>;
}
/** Only private upload handles can enter a payload. Never accept a caller-supplied object URL. */
export interface AttachmentReference {
  readonly attachmentId: string;
  readonly mimeType: string;
  readonly byteLength: number;
}
export interface ValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: LocalizedText;
}
export interface ValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}
export interface ReferenceField {
  readonly name: string;
  readonly type: string;
  readonly label_bn: string;
  readonly required_html: boolean;
  readonly maxlength: string | null;
  readonly accept: string | null;
  readonly repeatable_array: boolean;
}
export interface ReferenceService {
  readonly service_no: number;
  readonly name_bn: string;
  readonly name_en: string;
  readonly category_en: string;
  readonly initial_form_path_pattern: string;
  readonly initial_form_family:
    | "common_order_payment"
    | "specialist_additional_information";
  readonly field_group_codes: readonly string[];
  readonly service_specific_visible_field_names: readonly string[];
  readonly form_count: number;
  readonly forms: readonly Readonly<{
    form_index: number;
    method: string;
    observed_submit_path: string;
    fields: readonly ReferenceField[];
  }>[];
  readonly evidence_file: string;
  readonly evidence_limit: string;
}
