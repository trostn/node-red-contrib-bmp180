'------------------------ Declaration ------------------------'

const i2c = require('i2c-bus');
var EventEmitter = require('events').EventEmitter;
var _ = require('underscore');
var defaultOptions = {
        'address' : 119,
        'device' : 1,
        'mode' : 1,
		'units' : "Meter",
		'sealevel' : 0
    };

'------------------------ bmp180 ------------------------'
var bmp180 = function (opts) {

    var self = this;
    if( typeof(opts.device) == "string") { opts.device = Number(opts.device); }
    self.options = _.extend({}, defaultOptions, opts);
    self.events = new EventEmitter();
//    self.wire = new Wire(parseInt(this.options.address,10), {device: this.options.device});
    self.wire = i2c.open(this.options.device, err => {
	if(err) throw err;
    });
    self.events.on('calibrated', function () {
        self.readData(self.userCallback);
    });
};

'------------------------ Modes ------------------------'
bmp180.prototype.modes = {
    'ULTRA_LOW_POWER' : 0,
    'STANDARD' : 1,
    'HIGHRES' : 2,
    'ULTRA_HIGHRES' : 3
};

'------------------------ time to wait based on modes ------------------------'
bmp180.prototype.getTimeToWait = function () {
    var timeToWait = 16;

    switch (this.options.mode) {
        case this.modes.ULTRA_LOW_POWER:
            timeToWait = 10;
            break;
        case this.modes.HIGHRES:
            timeToWait = 28;
            break;
        case this.modes.ULTRA_HIGHRES:
            timeToWait = 104;
            break;
    }
    return timeToWait;
};

'------------------------ Calibration registers ------------------------'
bmp180.prototype.calibrationRegisters =
 [
    {'name': 'ac1','location': 0xAA},
    {'name': 'ac2','location': 0xAC},
    {'name': 'ac3','location': 0xAE},
    {'name': 'ac4','location': 0xB0,'type': 'uint16'},
    {'name': 'ac5','location': 0xB2,'type': 'uint16'},
    {'name': 'ac6','location': 0xB4,'type': 'uint16'},
    {'name': 'b1','location': 0xB6},
    {'name': 'b2','location': 0xB8},
    {'name': 'mb','location': 0xBA},
    {'name': 'mc','location': 0xBC},
    {'name': 'md','location': 0xBE}
];

'------------------------ Registers ------------------------'
bmp180.prototype.registers = {
    'control': {'location': 0xF4,},
    'tempData': {'location': 0xF6,'type': 'uint16'},
    'pressureData': {'location': 0xF6,}
};

'------------------------ Commands ------------------------'
bmp180.prototype.commands = {
    'readTemp':  0x2E,
    'readPressure':  0x34
};

'------------------------ Unsigned ------------------------'
bmp180.prototype.unsigned = function(number) {
    if (number > 127) {number -= 256;}
    return number;
};

'------------------------ Write/read ------------------------'
bmp180.prototype.readWord = function (register, length, callback) {
    var self = this;
    if (typeof length == 'function') {
        callback = length;
        length = 2;
    }

    var buf = Buffer.alloc(2);
    self.wire.readI2cBlock(self.options.address, register.location, length, buf, function(err, br, bytes) {
        if (err) {
            throw(err);
        }

        var hi = bytes[0],
            lo = bytes[1],
            value;

        if (register.type !== 'uint16') {
            hi = self.unsigned(hi);
        }

        value = (hi << 8) + lo;
        callback(register, value);
    });
};

'------------------------ Calibration ------------------------'
bmp180.prototype.calibrate = function () {

    this.calibrationData = {};
    this.waitForCalibrationData();

    var self = this;

    this.calibrationRegisters.forEach(function(register) {
        self.readWord(register, function(reg, value) {
            self.calibrationData[reg.name] = value;
        });
    });
};

'------------------------ Wait for calibration ------------------------'
bmp180.prototype.waitForCalibrationData = function () {

    var register;
    var i;
    var ready = true;
	var self = this;

    for (i = 0; i < self.calibrationRegisters.length; i++) {
        register = self.calibrationRegisters[i];
        if (typeof self.calibrationData[register.name] === 'undefined') {
            ready = false;
        }
    }

    if (ready) {
        self.events.emit('calibrated');
    } else {
        setTimeout(function () {self.waitForCalibrationData();}, 5);
    }
};

'------------------------ Read raw temperature ------------------------'
bmp180.prototype.readTemperature = function (callback) {
    var self = this;
    self.wire.writeByte(self.options.address, self.registers.control.location, self.commands.readTemp, function(err) {
        if (err) {
            throw(err);
        }
        setTimeout(function() {self.readWord(self.registers.tempData, function(reg, value) {callback(value);});}, 5);
    });

};

'------------------------ convert temperature ------------------------'
bmp180.prototype.convertTemperature = function (raw) {
    var calibrationData = this.calibrationData;
    var x1 = ((raw - calibrationData.ac6) * calibrationData.ac5) >> 15,
        x2 = (calibrationData.mc << 11) / (x1 + calibrationData.md),
        temperature;
    calibrationData.b5 = x1 + x2;
    temperature = ((calibrationData.b5 + 8) >> 4) / 10.0;
    return temperature;
};

'------------------------ Read raw pressure ------------------------'
bmp180.prototype.readPressure = function (callback) {
    var self = this;
    self.wire.writeByte(self.options.address, self.registers.control.location, self.commands.readPressure + (self.options.mode << 6), function(err) {
        if (err) {
            throw(err);
        }
        var timeToWait = self.getTimeToWait();
	var buf = new Buffer([0,0,0]);
// TODO: konvertieren auf i2c-bus
        setTimeout(function() {self.wire.readI2cBlock(self.options.address, self.registers.pressureData.location, 3, buf, function(err, br, bytes) {
                if (err) {
                    throw(err);
                }
                var msb = bytes[0],
                    lsb = bytes[1],
                    xlsb = bytes[2],
                    value = ((msb << 16) + (lsb << 8) + xlsb) >> (8 - self.options.mode);
                callback(value);
            });
        }, timeToWait);
    });
};

'------------------------ Convert pressure ------------------------'
bmp180.prototype.convertPressure = function (raw) {
    var calibrationData = this.calibrationData;
    var b6 = calibrationData.b5 - 4000;
    var x1 = (calibrationData.b2 * (b6 * b6) >> 12) >> 11;
    var x2 = (calibrationData.ac2 * b6) >> 11;
    var x3 = x1 + x2;
    var b3 = (((calibrationData.ac1 * 4 + x3) << this.options.mode) + 2) / 4;
    x1 = (calibrationData.ac3 * b6) >> 13;
    x2 = (calibrationData.b1 * ((b6 * b6) >> 12)) >> 16;
    x3 = ((x1 + x2) + 2) >> 2;
    var b4 = (calibrationData.ac4 * (x3 + 32768)) >> 15;
    var b7 = (raw - b3) * (50000 >> this.options.mode);
    var p;
	
    if (b7 < 0x80000000) {p = (b7 * 2) / b4;}
	else {p = (b7 / b4) * 2;}

    x1 = (p >> 8) * (p >> 8);
    x1 = (x1 * 3038) >> 16;
    x2 = (-7375 * p) >> 16;
    p = p + ((x1 + x2 + 3791) >> 4);
    p = p / 100; // hPa

    return p;
};

'------------------------ Read data ------------------------'
bmp180.prototype.readData = function (callback) {
    var self = this;
    self.readTemperature(function (rawTemperature) {
        self.readPressure(function (rawPressure) {
            var temperature = self.convertTemperature(rawTemperature)
            var pressure = self.convertPressure(rawPressure);
			if (self.options.sealevel == 0) {
				if (self.options.units =="Imperial") {
					var sealevel = 29.921;
				} else {
					var sealevel = 1013.25;
				}
			}
			
			if (self.options.units =="Imperial") {
				sealevel = sealevel/0.750062;
			}
			
			var altitude = 44330.0 * (1 - Math.pow((pressure/sealevel),(1/5.255)));
			
			if (self.options.units =="Imperial") {
				temperature = (temperature * 1.8)+32;
				pressure = pressure*0.029921255347141645;
				altitude = altitude / 0.3804;
			};
			
            callback({'temperature': temperature, 'pressure': pressure, 'altitude': altitude, 'unit': self.options.units});
        });
    });
};

'------------------------ Read ------------------------'
bmp180.prototype.read = function (callback) {
    this.userCallback = callback;
    this.calibrate();
	return callback;
};

module.exports = bmp180;
