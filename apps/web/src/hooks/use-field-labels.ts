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

  return {
    labels,
    getLabel,
    userLabels,
    auditLabels,
    notificationLabels,
    isLoading,
    error,
    mutate,
  };
}
