import useSWR from 'swr';

interface FieldConfig {
  id: string;
  fieldId: string;
  defaultName: string;
  displayName: string;
  module: string;
  description?: string;
}

// Default field labels (fallback)
const defaultLabels: Record<string, string> = {
  // User Management
  'FLD_USER_001': 'User ID',
  'FLD_USER_002': 'Full Name',
  'FLD_USER_003': 'Email',
  'FLD_USER_004': 'Department',
  'FLD_USER_005': 'Role',
  'FLD_USER_006': 'Status',
  'FLD_USER_007': 'Last Login',
  'FLD_USER_008': 'Created',
  'FLD_USER_009': 'Actions',
  // Entity Templates
  'FLD_TMPL_001': 'Template Name',
  'FLD_TMPL_002': 'Description',
  'FLD_TMPL_003': 'Category',
  'FLD_TMPL_004': 'Attributes',
  'FLD_TMPL_005': 'Instances',
  'FLD_TMPL_006': 'Actions',
  // Entity Instances
  'FLD_INST_001': 'Entity Name',
  'FLD_INST_002': 'Description',
  'FLD_INST_003': 'Template',
  'FLD_INST_004': 'Parent Entity',
  'FLD_INST_005': 'Status',
  'FLD_INST_006': 'Created',
  'FLD_INST_007': 'Last Modified',
  'FLD_INST_008': 'Children',
  'FLD_INST_009': 'Actions',
  // Entity Attributes
  'FLD_ATTR_001': 'Attribute Name',
  'FLD_ATTR_002': 'Data Type',
  'FLD_ATTR_003': 'Required',
  'FLD_ATTR_004': 'Default Value',
  // Entity Telemetry
  'FLD_TELE_001': 'Telemetry Name',
  'FLD_TELE_002': 'Unit',
  'FLD_TELE_003': 'Data Type',
  // Entity Relationships
  'FLD_REL_001': 'Relationship Type',
  'FLD_REL_002': 'Source Entity',
  'FLD_REL_003': 'Target Entity',
  'FLD_REL_004': 'Notes',
  // Entity Identifiers
  'FLD_IDENT_001': 'Identifier Type',
  'FLD_IDENT_002': 'Identifier Value',
  'FLD_IDENT_003': 'Label',
  // Audit Trail
  'FLD_AUDIT_001': 'Timestamp',
  'FLD_AUDIT_002': 'Action',
  'FLD_AUDIT_003': 'Performed By',
  'FLD_AUDIT_004': 'Description',
  'FLD_AUDIT_005': 'IP Address',
  'FLD_AUDIT_006': 'Status',
  // Notifications
  'FLD_NOTIF_001': 'Title',
  'FLD_NOTIF_002': 'Message',
  'FLD_NOTIF_003': 'Type',
  'FLD_NOTIF_004': 'Date',
  // Connection Status
  'FLD_CONN_001': 'Connections Allowed',
  'FLD_CONN_002': 'Connections Used',
  'FLD_CONN_003': 'Parent Connections Allowed',
  'FLD_CONN_004': 'Parent Connections Used',
  // Entity Hierarchy
  'FLD_ASSET_001': 'Building Name',
  'FLD_ASSET_002': 'Block Name',
  'FLD_ASSET_003': 'Area Name',
  'FLD_ASSET_004': 'Device Name',
  'FLD_ASSET_005': 'Serial Number',
};

export function useFieldLabels() {
  const { data, error, isLoading, mutate } = useSWR<FieldConfig[]>('/api/config/field-ids', {
    revalidateOnFocus: false,
    dedupingInterval: 300000, // Cache for 5 minutes
  });

  // Build a lookup map from fieldId to displayName
  const labels: Record<string, string> = { ...defaultLabels };

  if (data && Array.isArray(data)) {
    data.forEach((field) => {
      labels[field.fieldId] = field.displayName;
    });
  }

  // Helper function to get a label by field ID
  const getLabel = (fieldId: string): string => {
    return labels[fieldId] || fieldId;
  };

  // Common field accessors for convenience
  const userLabels = {
    userId: labels['FLD_USER_001'] || 'User ID',
    fullName: labels['FLD_USER_002'] || 'Full Name',
    email: labels['FLD_USER_003'] || 'Email',
    department: labels['FLD_USER_004'] || 'Department',
    role: labels['FLD_USER_005'] || 'Role',
    status: labels['FLD_USER_006'] || 'Status',
    lastLogin: labels['FLD_USER_007'] || 'Last Login',
    created: labels['FLD_USER_008'] || 'Created',
    actions: labels['FLD_USER_009'] || 'Actions',
  };

  const templateLabels = {
    name: labels['FLD_TMPL_001'] || 'Template Name',
    description: labels['FLD_TMPL_002'] || 'Description',
    category: labels['FLD_TMPL_003'] || 'Category',
    attributes: labels['FLD_TMPL_004'] || 'Attributes',
    instances: labels['FLD_TMPL_005'] || 'Instances',
    actions: labels['FLD_TMPL_006'] || 'Actions',
  };

  const instanceLabels = {
    name: labels['FLD_INST_001'] || 'Entity Name',
    description: labels['FLD_INST_002'] || 'Description',
    template: labels['FLD_INST_003'] || 'Template',
    parent: labels['FLD_INST_004'] || 'Parent Entity',
    status: labels['FLD_INST_005'] || 'Status',
    created: labels['FLD_INST_006'] || 'Created',
    lastModified: labels['FLD_INST_007'] || 'Last Modified',
    children: labels['FLD_INST_008'] || 'Children',
    actions: labels['FLD_INST_009'] || 'Actions',
  };

  const attributeLabels = {
    attributeName: labels['FLD_ATTR_001'] || 'Attribute Name',
    dataType: labels['FLD_ATTR_002'] || 'Data Type',
    required: labels['FLD_ATTR_003'] || 'Required',
    defaultValue: labels['FLD_ATTR_004'] || 'Default Value',
  };

  const telemetryLabels = {
    telemetryName: labels['FLD_TELE_001'] || 'Telemetry Name',
    unit: labels['FLD_TELE_002'] || 'Unit',
    dataType: labels['FLD_TELE_003'] || 'Data Type',
  };

  const relationshipLabels = {
    type: labels['FLD_REL_001'] || 'Relationship Type',
    source: labels['FLD_REL_002'] || 'Source Entity',
    target: labels['FLD_REL_003'] || 'Target Entity',
    notes: labels['FLD_REL_004'] || 'Notes',
  };

  const identifierLabels = {
    type: labels['FLD_IDENT_001'] || 'Identifier Type',
    value: labels['FLD_IDENT_002'] || 'Identifier Value',
    label: labels['FLD_IDENT_003'] || 'Label',
  };

  const auditLabels = {
    timestamp: labels['FLD_AUDIT_001'] || 'Timestamp',
    action: labels['FLD_AUDIT_002'] || 'Action',
    performedBy: labels['FLD_AUDIT_003'] || 'Performed By',
    description: labels['FLD_AUDIT_004'] || 'Description',
    ipAddress: labels['FLD_AUDIT_005'] || 'IP Address',
    status: labels['FLD_AUDIT_006'] || 'Status',
  };

  const notificationLabels = {
    title: labels['FLD_NOTIF_001'] || 'Title',
    message: labels['FLD_NOTIF_002'] || 'Message',
    type: labels['FLD_NOTIF_003'] || 'Type',
    date: labels['FLD_NOTIF_004'] || 'Date',
  };

  const connectionLabels = {
    connectionsAllowed: labels['FLD_CONN_001'] || 'Connections Allowed',
    connectionsUsed: labels['FLD_CONN_002'] || 'Connections Used',
    parentConnectionsAllowed: labels['FLD_CONN_003'] || 'Parent Connections Allowed',
    parentConnectionsUsed: labels['FLD_CONN_004'] || 'Parent Connections Used',
  };

  const assetLabels = {
    buildingName: labels['FLD_ASSET_001'] || 'Building Name',
    blockName: labels['FLD_ASSET_002'] || 'Block Name',
    areaName: labels['FLD_ASSET_003'] || 'Area Name',
    deviceName: labels['FLD_ASSET_004'] || 'Device Name',
    serialNumber: labels['FLD_ASSET_005'] || 'Serial Number',
  };

  return {
    labels,
    getLabel,
    userLabels,
    templateLabels,
    instanceLabels,
    attributeLabels,
    telemetryLabels,
    relationshipLabels,
    identifierLabels,
    auditLabels,
    notificationLabels,
    connectionLabels,
    assetLabels,
    isLoading,
    error,
    mutate,
  };
}
