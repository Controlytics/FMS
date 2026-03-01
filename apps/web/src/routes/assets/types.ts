export interface TreeNode {
  id: string;
  name: string;
  parentId: string | null;
  templateId: string;
  status: string;
  template: { name: string; icon: string };
  _count: { children: number };
}

export interface TelemetryDefinition {
  fieldName: string;
  dataType: string;
  unit?: string;
  description?: string;
}

export interface AssetTemplate {
  id: string;
  name: string;
  description?: string;
  icon: string;
  version: number;
  isActive: boolean;
  attributeSchema: AttributeDefinition[];
  checklistSchema?: any;
  telemetrySchema?: TelemetryDefinition[];
  expectedIdentifiers: any[];
  maxConnections?: number;
  maxParentConnections?: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  _count?: { instances: number };
}

export interface AttributeDefinition {
  fieldName: string;
  dataType: string;
  required: boolean;
  defaultValue?: any;
  unit?: string;
  dropdownOptions?: string[];
  numericConstraints?: {
    enabled: boolean;
    min?: number;
    max?: number;
    resolution?: number;
  };
}

export interface AssetInstance {
  id: string;
  name: string;
  description?: string;
  templateId: string;
  templateVersion: number;
  status: string;
  attributes: Record<string, any>;
  telemetryConfig?: Record<string, any>;
  customAttributes?: Record<string, any>;
  parentId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy?: string;
  template: AssetTemplate;
  parent?: { id: string; name: string; templateId: string } | null;
  sourceRelations: AssetRelation[];
  targetRelations: AssetRelation[];
  identifiers: AssetIdentifier[];
  _count?: { sourceRelations?: number };
}

export interface AssetRelation {
  id: string;
  sourceAssetId: string;
  targetAssetId: string;
  relationshipType: string;
  customLabel?: string;
  notes?: string;
  createdAt: string;
  sourceAsset?: { id: string; name: string };
  targetAsset?: { id: string; name: string };
}

export interface AssetIdentifier {
  id: string;
  assetId: string;
  identifierType: string;
  identifierValue: string;
  label?: string;
  isPrimary: boolean;
  createdAt: string;
}

export interface AuditRecord {
  id: string;
  userId: string;
  action: string;
  targetType: string;
  targetId: string;
  reason?: string;
  signatureMeaning?: string;
  beforeValue?: any;
  afterValue?: any;
  timestamp: string;
}

export interface PaginatedInstances {
  data: (TreeNode & { description?: string; createdAt: string })[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
