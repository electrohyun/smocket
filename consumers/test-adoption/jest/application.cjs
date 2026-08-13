const { io } = require('socket.io-client');

exports.connect = function connect(url) {
  return io(url);
};
