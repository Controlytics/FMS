import useSWR from 'swr';

/** One row of `GET /api/config/field-ids/current` — the label and nothing else. */
interface FieldConfig {
  fieldId: string;
  displayName: string;
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
  // Entity Management
  'FLD_ASSET_001': 'Building Name',
  'FLD_ASSET_002': 'Block Name',
  'FLD_ASSET_003': 'Area Name',
  'FLD_ASSET_004': 'Device Name',
  'FLD_ASSET_005': 'Serial Number',
  // Attributes
  'FLD_ATTR_001': 'Attribute Name',
  // Telemetry
  'FLD_TELE_001': 'Telemetry Name',
};

export function useFieldLabels() {
  // `/current` is readable by every signed-in user. The bare list needs
  // CONFIG_READ, so reading it here 403'd for operators on every page and their
  // labels silently stayed on the defaults below (fixed 2026-10-01).
  const { data, error, isLoading, mutate } = useSWR<FieldConfig[]>('/api/config/field-ids/current', {
    revalidateOnFocus: false,
    revalidateOnMount: true, dedupingInterval: 5000, // Cache for 5 minutes
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
  };

  const assetLabels = {
    buildingName: labels['FLD_ASSET_001'] || 'Building Name',
    blockName: labels['FLD_ASSET_002'] || 'Block Name',
    areaName: labels['FLD_ASSET_003'] || 'Area Name',
    deviceName: labels['FLD_ASSET_004'] || 'Device Name',
    serialNumber: labels['FLD_ASSET_005'] || 'Serial Number',
  };

  const attributeLabels = {
    attributeName: labels['FLD_ATTR_001'] || 'Attribute Name',
  };

  const telemetryLabels = {
    telemetryName: labels['FLD_TELE_001'] || 'Telemetry Name',
  };

  return {
    labels,
    getLabel,
    userLabels,
    assetLabels,
    attributeLabels,
    telemetryLabels,
    isLoading,
    error,
    mutate,
  };
}
