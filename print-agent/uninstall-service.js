const path = require('path');
const Service = require('node-windows').Service;

const svc = new Service({
  name: 'CargobarPrintAgent',
  script: path.join(__dirname, 'server.js')
});

svc.on('uninstall', () => console.log('Servis kaldırıldı.'));
svc.uninstall();
