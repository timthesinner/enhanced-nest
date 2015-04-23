/**
 * Copyright (c) 2015 TimTheSinner All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
module.exports = (function() {
    'use strict';
    var d3 = require('./d3-scale').d3,
        humidity_scale = d3.scale.linear().domain([-20, 40]).range([15, 45]),
        request = require('request'),
        crypto = require('crypto'),
        self = { services: {} };

    function wrappedExec(fn) {
        return function() {
            try {
                fn.apply(null, arguments);
            } catch (err) {
                console.log("Test", err);
            }
        }
    }

    function firstChild(obj) {
        for(var key in obj) {
            return obj[key];
        }
    }

    function findInArray(arr, key, value) {
        for (var entry in arr) {
            entry = arr[entry];
            if (entry[key] == value) {
                return entry;
            }
        }   
    }

    function convertFromCelciusTemp(temp, units) {
        if (units === 'F') {
            return Number(temp) * 1.8 + 32.0;
        } else {
            return Number(temp);
        }
    }

    function convertToCelciusTemp(temp, units) {
        if (units === 'F') {
            return (Number(temp) - 32) * (5/9);
        } else {
            return Number(temp);
        }
    }

    function deviceState(hum, heat, cool) {
        if (hum) {
            return (heat ? 'hum+heat' : cool ? 'hum+cool' : 'hum');
        }
        return (heat ? 'heat' : cool ? 'cool' : 'off');
    }

    function toInt(value) {
        return Math.round(value);
    }

    function config(config) {
        if (! config) { console.log('configuration must be defined'); process.exit(1); }

        if (! config.app) { console.log('config.app must be defined and set to your express instance.'); process.exit(1); }
        self.app = config.app;

        if (config.userMap) {
            self.userMap = config.userMap;
        } else {
            self.userMap = function(userHash) {
                return self.services[userHash];
            }
        }

        if (config.persist) {
            self.persist = persist;
        } else {
            self.persist = (function() {
                var fs = require('fs');
                return {
                    saveUser: function(userMeta, userHash, callback) {                        
                        fs.writeFile('user.dat', JSON.stringify({
                            userHash: userHash,
                            userMeta: userMeta
                        }), 'utf8', function(err) {
                            if (callback) {
                                if (err) {
                                    callback(null, err);
                                } else {
                                    callback({success: true});
                                }
                            }
                        });
                    }, getUser: function(userHash, callback) {
                        fs.readFile('user.dat', 'utf8', function(err, data) {
                            if (err) { callback(null, err); return;  }
                            if (data) { data = JSON.parse(data); if (data.userHash === userHash) { callback(data); return; } }
                            callback(null, { security: 'user hash did not match' });
                        });
                    } 
                };
            })();
        }

        if (config.metrics) {
            self.metrics = config.metrics;
        } else {
            self.metrics = (function() {
                var fs = require('fs'),
                    metrics = {},
                    waitingToWrite = 0;

                fs.readFile('metrics.dat', 'utf8', function(err, data) {
                    if (data) {
                        data = JSON.parse(data);
                        for (var name in data) {
                            if (data.hasOwnProperty(name)) {
                                metrics[name] = data[name];
                            }
                        }
                    }
                });

                return {
                    saveMetric: function(userHash, deviceId, metric) {
                        var user = metrics[userHash];
                        if (! user) { user = { }; metrics[userHash] = user; }

                        var deviceMetrics = user[deviceId];
                        if (! deviceMetrics) {  deviceMetrics = []; user[deviceId] = deviceMetrics; }

                        deviceMetrics.push(metric);

                        waitingToWrite += 1;
                        setTimeout(function() {
                            waitingToWrite -= 1;
                            if (! waitingToWrite) {
                                fs.writeFile('metrics.dat', JSON.stringify(metrics), 'utf8', function(err) {
                                    if (err) { console.log(err); }
                                });
                            }
                        }, 500);
                    }, getMetrics: function(userHash, deviceId, callback) {
                        if (metrics[userHash]) {
                            if (deviceId) {
                                callback(metrics[userHash][deviceId]);
                            } else {
                                callback(metrics[userHash]);
                            }
                        } else {
                            callback([]);
                        }
                    }
                }  
            })();
        }

        self.app.param(function(name, fn){
            if (fn instanceof RegExp) {
                return function(req, res, next, val){
                    var captures;
                    if (captures = fn.exec(String(val))) {
                        req.params[name] = captures[0];
                        next();
                    } else {
                        next('route');
                    }
                }
            }
        });
        self.app.param('userHash', /^.+$/);
        self.app.param('id', /^.+$/);
        self.app.param('deviceId', /^.+$/);
        self.app.param('component', /^.+$/);
        self.app.param('field', /^.+$/);

        self.app.post('/login', wrappedExec(function(req, res) {
            req.body.success = function(resp) { res.send(resp); };
            buildService(req.body);
        }));

        self.app.get('/:userHash/currentEnv', wrappedExec(function(req, res) {
            lookupServiceAndExecute(req.params.userHash, function(service) {
                service.currentEnv(function(currentEnv) {
                    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
                    res.status(200).send(currentEnv);
                });
            });
        }));

        self.app.get('/:userHash/metrics/:deviceId', wrappedExec(function(req, res) {
            self.metrics.getMetrics(req.params.userHash, req.params.deviceId, function(metrics) {
                res.status(200).send(metrics);
            });
        }));

        self.app.get('/:userHash/metrics', wrappedExec(function(req, res) {
            self.metrics.getMetrics(req.params.userHash, null, function(metrics) {
                res.status(200).send(metrics);
            });
        }));

        self.app.put('/:userHash/device/:id/:component/:field', wrappedExec(function(req, res) {
            lookupServiceAndExecute(req.params.userHash, function(service) {
                deviceFunctionMap[req.params.component][req.params.field](service, req.params.id, req, res);
            });
        }));
    }

    function lookupServiceAndExecute(userHash, success) {
        var service = self.userMap(userHash),
            _success = function(service) {
                service.intervalID = setInterval(function() {
                    if (service.initialized) {
                        clearInterval(service.intervalID);
                        success(service);
                    }
                }, 100);
            };

        if (service) {
            _success(service);
            return;
        }

        self.persist.getUser(userHash, function(user, err) {
            if (user) {
                if (! user.userMeta.target_humidity) {
                    user.userMeta.target_humidity = 40;
                }
                service = buildService(user.userMeta);
                _success(service);
            }
        });
    }

    var deviceFunctionMap = (function() {
        function normalizeHum(hum) {
            return hum - (hum % 5);
        }
        
        function setTargetHumidity(service, deviceId, hum, success) {
            hum = toInt(Number(hum));
            if (hum < 10) { hum = 10; }
            if (hum > 60) { hum = 60; }
            hum = hum - (hum % 5);
            service.postWithAuth(service.transportUrl + "/v2/put/device." + deviceId, {target_humidity:hum}, success);
        }

        return {
            setTargetHumidity: setTargetHumidity,
            normalizeHum: normalizeHum,
            hvac: {
                target_temp: function(service, deviceId, req, res) {
                    service.postWithAuth(service.transportUrl + "/v2/put/shared." + deviceId, {target_change_pending:true, target_temperature:convertToCelciusTemp(req.body.value, req.body.units)}, function(resp) {
                        resp.original_body = req.body;
                        res.status(200).send(resp);
                    });
                }
            }, 
            humidity: {
                target_humidity: function(service, deviceId, req, res) {
                    setTargetHumidity(service, deviceId, req.body.value, function(resp) {
                        resp.original_body = req.body;
                        res.status(200).send(resp);
                    });
                }
            }
        }
    })();

    function getHash(obj) {
        var md5Hash = crypto.createHash('md5');
        md5Hash.update(obj, 'utf8');
        return md5Hash.digest('hex');
    }


    function hashCallback(userMeta, userHash) {
        if (userMeta && userMeta.success) {
            userMeta.success({userId: userHash});
        }
    }

    function hashFromMeta(userMeta) {
        if (userMeta.oAuth) {
            return null;
        }

        return getHash(userMeta.email);
    }

    function lookupService(userMeta) {
        var userHash = hashFromMeta(userMeta);
        if (userHash) {
            if (self.services[userHash] && self.services[userHash].initialized) {
                hashCallback(userMeta, userHash);
                return self.services[userHash];
            } 
        }
    }

    function registerService(userMeta, service) {
        if (userMeta.oAuth) {

        } else {
            var userHash = getHash(userMeta.email);
            self.services[userHash] = service;

            if (! userMeta.target_humidity) {
                userMeta.target_humidity = 40;
            }

            self.persist.saveUser(userMeta, userHash);
            hashCallback(userMeta, userHash);
        }
    }

    function buildService(userMeta) {
        var service = lookupService(userMeta);
        if (service) {
            return service;
        }

        service = { initialized: false, type: userMeta.oAuth ? 'o-auth' : 'hacked' };
        registerService(userMeta, service);

        if (userMeta.oAuth) {
            console.log('OAuth is not supported atm');
        } else {
            service.refreshAuth = function() {
                request.post({
                    url: 'https://home.nest.com/user/login',
                    json: { 'email': userMeta.email, 'password': userMeta.password },
                    headers: { 'user-agent': 'Nest/1.1.0.10 CFNetwork/548.0.4' }
                }, function(err, res, body) {
                    if (err) {
                        console.log(body);
                        service.initialized = false;
                    } else {
                        service.initialized = true;
                        service.userId = body.userid;
                        service.transportUrl = body.urls.transport_url;
                        service.weatherUrl = body.urls.weather_url;
                        service.accessToken = body.access_token;
                    }
                });
            };
            service.refreshAuth();

            service.postWithAuth = function(url, json, success) {
                request.post({ 
                    url: url, method: 'POST', json: json,
                    headers: { 
                        'user-agent': 'Nest/1.1.0.10 CFNetwork/548.0.4',
                        'Authorization': 'Basic ' + service.accessToken,
                        'X-n1-user-id': service.userId,
                        'X-n1-protocol-version': '1'
                    }
                }, function(e, r, resp) {
                    if (e) {
                        console.log('Could not POST: ' + url, e);
                        success({url: url, code: 'unknown', error: e, state: 'failure', posted_json: json});
                    } else if (r && r.statusCode != 200) {
                        console.log('Could not POST: ' + url, r.statusCode);
                        success({url: url, code: r.statusCode, state: 'failure', posted_json: json});
                    } else {
                        if (resp) {
                            var resp = JSON.parse(resp);
                            resp.posted_json = json
                            success(resp);
                        } else {
                            success({url: url, code: r.statusCode, state: 'success', posted_json: json});
                        }
                    } 
                });
            };

            service.getWithAuth = function(url, success) {
                request.get({ 
                    url: url,
                    headers: { 
                        'user-agent': 'Nest/1.1.0.10 CFNetwork/548.0.4',
                        'Authorization': 'Basic ' + service.accessToken,
                        'X-n1-user-id': service.userId,
                        'X-n1-protocol-version': '1'
                    }
                }, function(e, r, resp) {
                    if (!e) {
                        success(JSON.parse(resp));
                    } else {
                        console.log('Could not GET: ' + url);
                    }
                });
            };

            service.currentEnv = function(success) {
                service.getWithAuth(service.transportUrl + "/v2/mobile/user." + service.userId, function(userData) {
                    var where = firstChild(userData.where),
                        structure = firstChild(userData.structure);
                    if (where && structure) {
                        service.getWithAuth(service.weatherUrl + 'forecast=' + structure['postal_code'] + ',' + structure['country_code'], function(forecast) {
                            forecast = firstChild(forecast);
                            var currentEnv = {
                                inside: [],
                                outside: {
                                    current_temp: forecast.current['temp_f'],
                                    current_humidity: forecast.current['humidity'],
                                    current_condition: forecast.current['condition'],
                                    current_wind_speed: forecast.current['wind_mph'],
                                    current_wind_dir: forecast.current['wind_dir'],
                                }
                            }
                            
                            for (var deviceId in userData.device) {
                                var device = userData.device[deviceId],
                                    shared = userData.shared[deviceId];
                                    
                                currentEnv.inside.push({
                                    device: deviceId,
                                    type: 'thermostat',
                                    location: findInArray(where['wheres'], 'where_id', device['where_id']).name,
                                    has_leaf: device['leaf'],
                                    state: deviceState(device['humidifier_state'], shared['hvac_heater_state'], shared['hvac_ac_state']),
                                    'nest-metadata': {
                                        device: device,
                                        shared: shared
                                    },
                                    humidity: {
                                        has_humidifier: device['has_humidifier'],
                                        humidity_requested: device['humidifier_state'],
                                        current_humidity: device['current_humidity'],
                                        target_humidity: device['target_humidity'],
                                        control_enabled: device['target_humidity_enabled'],
                                        
                                        metadata: {
                                            type: device['humidifier_type'],
                                            control_lockout_enabled: device['humidity_control_lockout_enabled'],
                                            control_lockout_start: device['humidity_control_lockout_start_time'],
                                            control_lockout_end_time: device['humidity_control_lockout_end_time']
                                        }
                                    },
                                    hvac: {
                                        ac_requested: shared['hvac_ac_state'],
                                        fan_requested: device['fan_control_state'],
                                        heat_requested: shared['hvac_heater_state'],
                                        
                                        temp_scale: device['temperature_scale'],
                                        target_temp: convertFromCelciusTemp(shared['target_temperature'], device['temperature_scale']),
                                        current_temp: convertFromCelciusTemp(shared['current_temperature'], device['temperature_scale']),
                                    }
                                });
                            }

                            success(currentEnv);
                        });
                    }
                });
            };
        }

        function updateHumidity() {
            service.currentEnv(function(currentEnv) {
                if (currentEnv) {
                    var metric = { has_leaf: currentEnv.has_leaf, collected_at: new Date() };
                    if (currentEnv.outside) {
                        metric.user_target_humidity = userMeta.target_humidity;
                        metric.outside_current_temp = currentEnv.outside.current_temp;
                        metric.outside_current_humidity = currentEnv.outside.current_humidity;
                        metric.temp_corrected_humidity = humidity_scale(currentEnv.outside.current_temp);
                        metric.temp_corrected_user_capped_humidity = metric.temp_corrected_humidity > metric.user_target_humidity ? metric.user_target_humidity : metric.temp_corrected_humidity;
                        metric.temp_corrected_humidity_normalized = deviceFunctionMap.normalizeHum(metric.temp_corrected_user_capped_humidity);
                    }

                    if (currentEnv.inside) {
                        for (var i in currentEnv.inside) {
                            var device = currentEnv.inside[i],
                                deviceMetric = JSON.parse(JSON.stringify(metric));

                            deviceMetric.location = device.location;
                            deviceMetric.state = device.state;

                            deviceMetric.inside_current_humidity = device.humidity.current_humidity;
                            if (device.humidity.has_humidifier) {
                                deviceMetric.inside_target_humidity = device.humidity.target_humidity;
                                deviceMetric.inside_humidity_requested = device.humidity.humidity_requested;

                                if (deviceMetric.temp_corrected_humidity_normalized && device.humidity.target_humidity != deviceMetric.temp_corrected_humidity_normalized) {
                                    deviceFunctionMap.setTargetHumidity(service, device.device, metric.temp_corrected_humidity_normalized, function(resp) {
                                        console.log('Outside temp is ' + metric.outside_current_temp + ' relative humidity should not exceed ' + metric.temp_corrected_humidity + '%, setting target humidity to ' + metric.temp_corrected_humidity_normalized + '%');
                                    });
                                }
                            }
							
							if (deviceMetric.inside_current_humidity && metric.temp_corrected_humidity && deviceMetric.inside_current_humidity > metric.temp_corrected_humidity) {
								console.log(device.location + ' has ' + deviceMetric.inside_current_humidity + '% humidity, the max for the current outside temp of ' + metric.outside_current_temp + ' is ' + deviceMetric.temp_corrected_humidity + '%');
							}

                            deviceMetric.inside_current_temp = device.hvac.current_temp;
                            deviceMetric.inside_target_temp = device.hvac.target_temp;
                            deviceMetric.inside_ac_requested = device.hvac.ac_requested;
                            deviceMetric.inside_fan_requested = device.hvac.fan_requested;
                            deviceMetric.inside_heat_requested = device.hvac.heat_requested;

                            self.metrics.saveMetric(hashFromMeta(userMeta), device.device, deviceMetric);
                        }
                    }
                }
            });
        }

        (function() {
          setInterval(updateHumidity, 60000);
        })();

        return service;
    }

    return {
        buildService: buildService,
        config: config
    };
})();
