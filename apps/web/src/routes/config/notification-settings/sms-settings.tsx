import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import useSWR from 'swr';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface SmsConfig {
  provider: string;
  enabled: boolean;
  defaultCountryCode: string;
  senderId: string;
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioFromNumber: string;
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
  awsRegion: string;
  vonageApiKey: string;
  vonageApiSecret: string;
  vonageFromNumber: string;
  httpGatewayUrl: string;
  httpGatewayMethod: string;
  httpGatewayHeaders: Record<string, string>;
  httpGatewayBodyTemplate: string;
}

const PROVIDERS = [
  { value: 'twilio', label: 'Twilio', description: 'Popular cloud communication platform' },
  { value: 'aws-sns', label: 'AWS SNS', description: 'Amazon Simple Notification Service' },
  { value: 'vonage', label: 'Vonage (Nexmo)', description: 'Communication APIs' },
  { value: 'http-gateway', label: 'HTTP Gateway', description: 'Custom HTTP-based SMS gateway' },
];

export function SmsSettingsPage() {
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [testing, setTesting] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testResult, setTestResult] = useState<{ success: boolean; message?: string; error?: string } | null>(null);

  const { data, mutate } = useSWR('/api/notification-settings/sms', { revalidateOnMount: true, dedupingInterval: 0 });

  const defaultValues: SmsConfig = {
    provider: 'twilio', enabled: false, defaultCountryCode: '+91', senderId: 'DigiLog',
    twilioAccountSid: '', twilioAuthToken: '', twilioFromNumber: '',
    awsAccessKeyId: '', awsSecretAccessKey: '', awsRegion: 'ap-south-1',
    vonageApiKey: '', vonageApiSecret: '', vonageFromNumber: '',
    httpGatewayUrl: '', httpGatewayMethod: 'POST', httpGatewayHeaders: {}, httpGatewayBodyTemplate: '',
  };

  const { register, handleSubmit, watch, reset, formState: { isSubmitting, isDirty } } = useForm<SmsConfig>({
    values: data ? { ...defaultValues, ...data } : defaultValues,
  });

  const provider = watch('provider');
  const enabled = watch('enabled');

  const onSubmit = async (formData: SmsConfig) => {
    setError('');
    setSuccess('');
    try {
      await apiClient.put('/api/notification-settings/sms', formData);
      setSuccess('SMS settings saved successfully');
      mutate();
      reset(formData);
    } catch (err: any) {
      setError(err.message || 'Failed to save');
    }
  };

  const onTest = async () => {
    if (!testPhone) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await apiClient.post<{ success: boolean; message?: string; error?: string }>(
        '/api/notification-settings/sms/test',
        { recipient: testPhone },
      );
      setTestResult(result);
    } catch (err: any) {
      setTestResult({ success: false, error: err.message || 'Test failed' });
    }
    setTesting(false);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/config" className="p-2 rounded-xl hover:bg-slate-100 transition-colors">
            <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="p-3 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 shadow-lg shadow-green-500/25">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">SMS Configuration</h1>
            <p className="text-sm text-slate-500">Configure SMS provider for text message notifications</p>
          </div>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>}
      {success && <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-xl text-sm">{success}</div>}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Enable toggle */}
        <div className="bg-white rounded-2xl border-2 border-slate-200 p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-slate-800">SMS Notifications</h3>
              <p className="text-sm text-slate-500 mt-1">Enable or disable SMS notification delivery</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" {...register('enabled')} className="sr-only peer" />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-green-100 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
            </label>
          </div>
        </div>

        {/* Provider Selection */}
        <div className="bg-white rounded-2xl border-2 border-slate-200 p-6 shadow-sm space-y-4">
          <h3 className="font-semibold text-slate-800">SMS Provider</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {PROVIDERS.map((p) => (
              <label
                key={p.value}
                className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${provider === p.value ? 'border-green-500 bg-green-50' : 'border-slate-200 hover:border-slate-300'}`}
              >
                <input type="radio" value={p.value} {...register('provider')} className="mt-1" />
                <div>
                  <div className="font-medium text-slate-800">{p.label}</div>
                  <div className="text-xs text-slate-500">{p.description}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Common Settings */}
        <div className="bg-white rounded-2xl border-2 border-slate-200 p-6 shadow-sm space-y-4">
          <h3 className="font-semibold text-slate-800">Common Settings</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Default Country Code</label>
              <Input {...register('defaultCountryCode')} placeholder="+91" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Sender ID</label>
              <Input {...register('senderId')} placeholder="DigiLog" />
            </div>
          </div>
        </div>

        {/* Provider-specific settings */}
        {provider === 'twilio' && (
          <div className="bg-white rounded-2xl border-2 border-slate-200 p-6 shadow-sm space-y-4">
            <h3 className="font-semibold text-slate-800">Twilio Settings</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Account SID</label>
                <Input {...register('twilioAccountSid')} placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Auth Token</label>
                <Input {...register('twilioAuthToken')} type="password" placeholder="Auth token" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">From Number</label>
                <Input {...register('twilioFromNumber')} placeholder="+1234567890" />
              </div>
            </div>
          </div>
        )}

        {provider === 'aws-sns' && (
          <div className="bg-white rounded-2xl border-2 border-slate-200 p-6 shadow-sm space-y-4">
            <h3 className="font-semibold text-slate-800">AWS SNS Settings</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Access Key ID</label>
                <Input {...register('awsAccessKeyId')} placeholder="AKIA..." />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Secret Access Key</label>
                <Input {...register('awsSecretAccessKey')} type="password" placeholder="Secret key" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Region</label>
                <Input {...register('awsRegion')} placeholder="ap-south-1" />
              </div>
            </div>
          </div>
        )}

        {provider === 'vonage' && (
          <div className="bg-white rounded-2xl border-2 border-slate-200 p-6 shadow-sm space-y-4">
            <h3 className="font-semibold text-slate-800">Vonage (Nexmo) Settings</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">API Key</label>
                <Input {...register('vonageApiKey')} placeholder="API key" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">API Secret</label>
                <Input {...register('vonageApiSecret')} type="password" placeholder="API secret" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">From Number</label>
                <Input {...register('vonageFromNumber')} placeholder="+1234567890 or sender name" />
              </div>
            </div>
          </div>
        )}

        {provider === 'http-gateway' && (
          <div className="bg-white rounded-2xl border-2 border-slate-200 p-6 shadow-sm space-y-4">
            <h3 className="font-semibold text-slate-800">HTTP Gateway Settings</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Gateway URL</label>
                <Input {...register('httpGatewayUrl')} placeholder="https://api.sms-provider.com/send?to={phone}&msg={message}" />
                <p className="text-xs text-slate-500 mt-1">Use {'{phone}'} and {'{message}'} as placeholders</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">HTTP Method</label>
                <select {...register('httpGatewayMethod')} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  <option value="POST">POST</option>
                  <option value="GET">GET</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Body Template (for POST)</label>
                <textarea
                  {...register('httpGatewayBodyTemplate')}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono h-24"
                  placeholder={'{"to": "{phone}", "message": "{message}"}'}
                />
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3">
          <Button type="submit" disabled={isSubmitting || !isDirty}>
            {isSubmitting ? 'Saving...' : 'Save Configuration'}
          </Button>
        </div>
      </form>

      {/* Test Section */}
      <div className="bg-white rounded-2xl border-2 border-slate-200 p-6 shadow-sm space-y-4">
        <h3 className="font-semibold text-slate-800">Test SMS Configuration</h3>
        <p className="text-sm text-slate-500">Send a test SMS to verify your settings.</p>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-700 mb-1">Phone Number</label>
            <Input
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              placeholder="+919876543210"
            />
          </div>
          <Button type="button" onClick={onTest} disabled={testing || !enabled || !testPhone} variant="outline">
            {testing ? 'Sending...' : 'Send Test SMS'}
          </Button>
        </div>
        {testResult && (
          <div className={`px-4 py-3 rounded-xl text-sm ${testResult.success ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
            {testResult.success ? testResult.message : testResult.error}
          </div>
        )}
      </div>
    </div>
  );
}
