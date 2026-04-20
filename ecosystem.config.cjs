module.exports = {
  apps: [
    {
      name: 'digilog-api',
      cwd: './apps/api',
      script: 'dist/app.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '1G',
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: './logs/digilog-api-error.log',
      out_file: './logs/digilog-api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      kill_timeout: 15000,
    },
  ],
};
