var i2cbmp180 = require('./resources/i2cbmp180');

module.exports = function(RED) {
	
	'------------------------ bmp180 ------------------------'
	function bmp180(n) {
		RED.nodes.createNode(this, n);
		var node = this;		
		var nodeDevice = n.device;
		var nodeAddress = n.address;
		var nodeMode = n.mode;
		var nodeUnits = n.units;
		var nodeSeaLevel = n.sealevel;
		node.on('input', function(msg) {
			try {
				var sensor = new i2cbmp180({device: nodeDevice, address: nodeAddress,mode: nodeMode, units: nodeUnits, SeaLevel: nodeSeaLevel});
				sensor.read(function (data){
					var msg = { payload: data };
					node.send(msg);
				});
			} catch (err) {
				node.error(err);
			}
		})
	}

	'------------------------ RED node function register ------------------------'
	RED.nodes.registerType('bmp180', bmp180);
}
