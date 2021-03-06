'use strict'

const jscad = require('jscad');
const polyline = require('polyline');
const hash = require('object-hash');
const fs = require('fs');
const util = require('util');

const config = {
    origin: "335 Central Ave 40056",
    minLatLng: [38.220, -85.730],  // must be smaller numbers than maxLatLng
    maxLatLng: [38.340, -85.467],
    // 1.5mm thick .. 3mm gap. 
    // so 80/3 = 26 across, 60/3 = 20 down but we start at 0 so -1
    steps: [48, 32],
}

const runConfig = {
    cacheDir: "./cache"
}

const printConfig = {
    // these are the limits of the printer .. mm ? 
    // MUST START at 0,0,0 for now
    desiredBounds: { min: [0, 0, 0], max: [320, 240, 20] },
    printRadius: 2, // in units of desired bounds -- determines cylinder thickness
    minThickness: 2, // added onto the bottom  
    detailSize: 1  // a way of eliminating duplicates at this level
}

const googleMapsClient = require('@google/maps').createClient({
    key: process.env.GOOGLE_MAPS_API_KEY,
    Promise: Promise
});

const latStep = (config.maxLatLng[0] - config.minLatLng[0]) / config.steps[0];
const lngStep = (config.maxLatLng[1] - config.minLatLng[1]) / config.steps[1];
var minStep = Math.abs(latStep) < Math.abs(lngStep) ? Math.abs(latStep) : Math.abs(lngStep);

function addLocation(locations, lat, lng) {

    // we know that we won't exceed the resolution of latstep and lngstep
    lat = lat - config.minLatLng[0];
    lat = lat / latStep;
    lat = Math.round(lat);
    lat = lat * latStep + config.minLatLng[0];

    lng = lng - config.minLatLng[1];
    lng = lng / lngStep;
    lng = Math.round(lng);
    lng = lng * lngStep + config.minLatLng[1];

    let key = hash([lat, lng]);
    locations[key] = [lat, lng];
}

function checkContainsLocation(locations, lat, lng) {

    // we know that we won't exceed the resolution of latstep and lngstep
    lat = lat - config.minLatLng[0];
    lat = lat / latStep;
    lat = Math.round(lat);
    lat = lat * latStep + config.minLatLng[0];

    lng = lng - config.minLatLng[1];
    lng = lng / lngStep;
    lng = Math.round(lng);
    lng = lng * lngStep + config.minLatLng[1];

    let key = hash([lat, lng]);
    return locations.hasOwnProperty(key);
}

function addDirectionsToPlot(dataToPlot, visitedLocations, result) {
    result.routes.forEach(route => {
        console.log("route: ", route.summary);
        var currentDuration = 0;
        route.legs.forEach(leg => {

            // trim off things at the ends of the legs that are too slow 
            // 1 mile in 2 minutes ~= 30 mph
            // var i = leg.steps.length - 1;
            // while (i > 5) {
            //     if (leg.steps[i].duration.value < 120 &&
            //         leg.steps[i].distance.value < 1609) {
            //         leg.steps.pop();
            //         i--;
            //         continue;
            //     } else {
            //         break;
            //     }
            // }

            leg.steps.forEach(step => {

                var chain = [];

                // if (step.travel_mode != "DRIVING") {
                //     return;
                // }

                var polyLinePoints = polyline.decode(step.polyline.points);
                var durationPerPoint = step.duration.value / (polyLinePoints.length - 1);
                var newDuration = currentDuration + step.duration.value;

                for (var pi = 0; pi < polyLinePoints.length; pi++) {
                    var x = polyLinePoints[pi][1];
                    var y = polyLinePoints[pi][0];

                    chain.push([x, y, currentDuration + durationPerPoint * pi]);
                    addLocation(visitedLocations, y, x);  // NOTE Latitude is first is y
                }
                currentDuration = newDuration;

                dataToPlot.push(chain);
            })
        })
    })

}

function getBounds(dataToPlot) {
    var bounds = { min: dataToPlot[0][0].slice(0), max: dataToPlot[0][0].slice(0) };
    dataToPlot.forEach(chain => {
        chain.forEach(link => {
            for (var d = 0; d < 3; d++) {
                if (link[d] < bounds.min[d]) bounds.min[d] = link[d];
                if (link[d] > bounds.max[d]) bounds.max[d] = link[d];
            }
        });
    });
    return bounds;
}

function pointScale(point, bounds, desiredBounds) {
    var newPoint = [];
    for (var i = 0; i < 3; i++) {
        var a = point[i] - bounds.min[i];  // zero-base it
        var b = a / (bounds.max[i] - bounds.min[i]); // 0..1 
        var c = b * (desiredBounds.max[i] - desiredBounds.min[i]);  // 0..x
        var d = c + desiredBounds.min[i];
        newPoint.push(d);
    }
    return newPoint;
}

async function cachedGoogleGetDirections(options) {
    let file = runConfig.cacheDir + "/googleDirections." + hash(options) + ".json";
    if (fs.existsSync(file)) {
        console.log("using cached file " + file + " for " + JSON.stringify(options));
        let rawdata = fs.readFileSync(file);
        return JSON.parse(rawdata);
    } else {
        console.log("asking google for " + JSON.stringify(options));
        let data = await (googleMapsClient.directions(options).asPromise());
        if (data && data.json && data.json.routes) {
            fs.writeFileSync(file, JSON.stringify(data.json));
            console.log("... saved to " + file);
            let rawdata = fs.readFileSync(file);
            return JSON.parse(rawdata);
        } else {
            return 0;
        }
    }
}

function getLeastDistanceTo(visitedLocations, lat, lng) {
    var result = { distance: 360, lat: null, lng: null };
    var keys = Object.keys(visitedLocations);
    for (var k of keys) {
        if (visitedLocations.hasOwnProperty(k)) {
            // calculate a distance.  Rather than doing math, just doing absolutes
            var g = visitedLocations[k];
            var distance = Math.abs(lat - g[0]) + Math.abs(lng - g[1]);
            if (distance < result.distance) {
                result.distance = distance;
                result.lat = lat;
                result.lng = lng;
            }
        }
    }
    if (result.distance == 360) return null;
    return result;
}

function chooseNextUnvisitedLocation(visitedLocations, ruledOutLocations, minDistance) {
    var most = { distance: 0, x: null, y: null };
    for (var lat = config.minLatLng[0]; lat <= config.maxLatLng[0]; lat += latStep) {
        for (var lng = config.minLatLng[1]; lng <= config.maxLatLng[1]; lng += lngStep) {

            if (!checkContainsLocation(ruledOutLocations, lat, lng)) {
                var check = getLeastDistanceTo(visitedLocations, lat, lng);
                if (check && check.distance > most.distance) {
                    most = check;
                    // this locaiton might be the 2nd best.  check it again. 
                } else if (check && check.distance <= minDistance) {
                    addLocation(ruledOutLocations, lat, lng)
                }
            }

        }
    }
    return most;
}

async function getDataToPlot(config) {
    var dataToPlot = [];
    var visitedLocations = {};
    var ruledOutLocations = {};

    var seedResponse = await cachedGoogleGetDirections(
        {
            origin: config.origin,
            destination: [config.minLatLng[0], config.minLatLng[1]],
            alternatives: false
        });
    if (!seedResponse) {
        console.log("Error getting seed route!");
        return;
    }
    addLocation(visitedLocations, config.minLatLng[0], config.minLatLng[1]);
    addDirectionsToPlot(dataToPlot, visitedLocations, seedResponse);

    var minDistance = (config.maxLatLng[0] - config.minLatLng[0]) / config.steps[0];
    var maxLocations = (config.steps[0] + 1) * (config.steps[1] + 1);
    do {
        console.log("locating next point.. visitedLocations " + Object.keys(visitedLocations).length + " ruledOutLocations " + Object.keys(ruledOutLocations).length + " of " + maxLocations);
        let nextStop = chooseNextUnvisitedLocation(visitedLocations, ruledOutLocations, minDistance);
        console.log(util.format("Found distance %d percent", (nextStop.distance / minDistance) * 100));
        if (nextStop.distance < minDistance) {
            console.log("No more closer points found");
            return dataToPlot;
        } else {
            var nextResponse = await cachedGoogleGetDirections({
                origin: config.origin,
                destination: [nextStop.lat, nextStop.lng]
            });
            addLocation(visitedLocations, nextStop.lat, nextStop.lng);
            addDirectionsToPlot(dataToPlot, visitedLocations, nextResponse);
        }
    }
    while (true);
}

async function getCachedDataToPlot(config) {

    let file = runConfig.cacheDir + "/dataToPlot." + hash(config) + ".json";
    if (fs.existsSync(file)) {
        console.log("using cached file " + file + " for " + JSON.stringify(config));
        let rawdata = fs.readFileSync(file);
        return JSON.parse(rawdata);
    } else {
        console.log("calculating data to plot for " + JSON.stringify(config));
        let data = await getDataToPlot(config);
        if (data) {
            fs.writeFileSync(file, JSON.stringify(data));
            console.log("... saved to " + file);
            let rawdata = fs.readFileSync(file);
            return JSON.parse(rawdata);
        } else {
            return [];
        }
    }
}

function scaleDataToPlot(dataToPlot, initialBounds, desiredBounds) {
    var result = [];
    dataToPlot.forEach(chain => {
        var newChain = [];
        chain.forEach(segment => {
            var newPoint = pointScale(segment, initialBounds, desiredBounds);
            newChain.push(newPoint);
        });
        result.push(newChain);
    });
    return result;
}

function getRamp(start, end, thick, zero) {
    var s = new CSG.Vector3D(start);
    var sb = new CSG.Vector3D([s._x, s._y, zero]);
    var e = new CSG.Vector3D(end);
    var eb = new CSG.Vector3D([e._x, e._y, zero]);

    var direction = e.minus(s).unit();
    var d = new CSG.Vector3D(direction._x, direction._y, 0);
    var n = new CSG.Vector3D([0, 0, 10]); // straight up
    var crossed = direction.cross(n).unit().times(thick / 2); // to the clockwise

    var poly1 = CSG.polyhedron({
        points: [
            s.minus(crossed),
            e.minus(crossed),
            e.plus(crossed),
            s.plus(crossed),
            sb.minus(crossed),
            eb.minus(crossed),
            eb.plus(crossed),
            sb.plus(crossed)
        ],
        faces: [
            [0, 1, 2, 3],
            [4, 5, 6, 7],
            [0, 4, 5, 1],
            [2, 6, 7, 3],
            [0, 3, 7, 4],
            [1, 5, 6, 2]
        ]
    });
    var poly2 = CSG.cylinder({ start: eb, end: e, radius: thick / 2, resolution: 8 })
    var poly3 = poly1.union(poly2);
    return poly3;
}

function getRampPrint(dataToPlot) {

    var minResolutionSq = Math.pow(printConfig.printRadius * 4, 2);

    var seen = [];
    var saved = 0;
    var model = [];
    var dTimer = new Date().getTime() + 10000; 
    var sTimer = dTimer; 
    for (var d = 0; d < dataToPlot.length; d++) {
        var dTime = new Date().getTime(); 
        if (dTime >= dTimer) { 
            console.log("getRampPrint " + d + "/" + dataToPlot.length);
            dTimer += 10000; 
        }
        var chain = dataToPlot[d];

        var pi = 0;
        for (var i = 1; i < chain.length; i++) {

            var dsq = Math.pow(chain[i][0] - chain[pi][0], 2) +
                Math.pow(chain[i][1] - chain[pi][1], 2) +
                Math.pow(chain[i][2] - chain[pi][2], 2);
            if (dsq > minResolutionSq || i == chain.length - 1) {

                // we've decided to print this one. 
                // lets generate a hash key to see if its worthy of printing
                var key = hash({
                    x1: Math.round(chain[pi][0] / printConfig.detailSize),
                    y1: Math.round(chain[pi][1] / printConfig.detailSize),
                    z1: Math.round(chain[pi][2] / printConfig.detailSize),
                    x2: Math.round(chain[i][0] / printConfig.detailSize),
                    y2: Math.round(chain[i][1] / printConfig.detailSize),
                    z2: Math.round(chain[i][2] / printConfig.detailSize)
                });
                if (!seen.hasOwnProperty(key)) {
                    var ramp = getRamp(chain[pi], chain[i], printConfig.printRadius, -printConfig.minThickness);
                    model.push(ramp);
                    seen[key] = 1;
                } else {
                    saved++;
                    var sTime = new Date().getTime(); 
                    if (sTime >= sTimer) {
                        console.log("saved " + saved + ", seen: " + Object.keys(seen).length);
                        sTimer += 10000; 
                    }
                }
                pi = i;
            }
        };
    };
    return model;
}

function getBiggestBounds(b1, b2) {
    return {
        min: [
            Math.min(b1.min[0], b2.min[0]),
            Math.min(b1.min[1], b2.min[1]),
            Math.min(b1.min[2], b2.min[2])],
        max: [
            Math.max(b1.max[0], b2.max[0]),
            Math.max(b1.max[1], b2.max[1]),
            Math.max(b1.max[2], b2.max[2]),
        ]
    };
}

function setxy(a, x, y, v) {
    if (typeof a !== 'object' || a === null) throw "1st parameter must be an object";
    var b = a[x];
    if (typeof a['ykeys'] !== 'object') a['ykeys'] = {};
    if (typeof b !== 'object' || b === null) {
        b = {};
        a[x] = b;
    }
    a['ykeys'][y] = y;
    b[y] = v;
}
function getxy(a, x, y) {
    if (typeof a !== 'object' || a === null) throw "1st parameter must be an object";
    var b = a[x];
    if (typeof b !== 'object' || b === null) return undefined;
    return b[y];
}

function plot2D(heightMap, start, end, scale, identifier, stack) {

    if (stack>10) { 
        console.log("plot2d: ", start, end);
    }

    var x1 = start[0] / scale;
    var y1 = start[1] / scale;
    var h1 = start[2];
    var x2 = end[0] / scale;
    var y2 = end[1] / scale;
    var h2 = end[2];

    var dx = Math.abs(x1 - x2);
    var dy = Math.abs(y1 - y2);

    if (dx < 0.5 && dy < 0.5) {
        var x = Math.round((x1 + x2) / 2.0);
        var y = Math.round((y1 + y2) / 2.0);
        var height = (h1 + h2) / 2.0;
        var c = getxy(heightMap, x, y);
        if (c && c.height && c.height < height) return;   // already good, not changing it

        setxy(heightMap, x, y, { height: height, identifier: identifier });
    } else {
        // divide into two! 
        var mx = (start[0] + end[0]) / 2.0;
        var my = (start[1] + end[1]) / 2.0;
        var mh = (h1 + h2) / 2.0;
        plot2D(heightMap, start, [mx, my, mh],scale, identifier, stack+1);
        plot2D(heightMap, [mx, my, mh], end,scale,identifier,stack+1);
    }
}

function iteratexy(heightMap, finit, fxy, fendx) {
    var xkeys = Object.keys(heightMap).filter(function (x) { return x != 'ykeys' }).sort(function (a, b) { return a - b });
    var ykeys = Object.keys(heightMap['ykeys']).sort(function (a, b) { return b - a });
    var buffer = finit();
    for (var yk of ykeys) {
        for (var xk of xkeys) {
            var v = getxy(heightMap, xk, yk);
            buffer = fxy(buffer, v);
        }
        if (fendx) buffer = fendx(buffer);
    }
    return buffer;
}

function dumpHeightMap(heightMap) {
    // this should be two functions

    var legend = ".`:;+oxOX#%$@";
    var legendLength = legend.length - 1;
    var minHeight = printConfig.desiredBounds.min[2];
    var maxHeight = printConfig.desiredBounds.max[2];

    return iteratexy(heightMap,
        function () { return ''; },
        function (buffer, v) {
            if (v && v.height) {
                var h = v.height;
                h = Math.round((h - minHeight) / (maxHeight - minHeight) * legendLength);
                //if (v.locked) h--; 
                if (h < 0) h = 0;
                if (h > legendLength) h = legendLength;
                return buffer + legend.charAt(h);
            } else {
                return buffer + ' ';
            }
            return buffer;
        },
        function (buffer) {
            return buffer + '\n';
        });
}

function dumpHeightMapByID(heightMap) {

    return iteratexy(heightMap,
        function () { return ''; },
        function (buffer, v) {
            if (v && v.identifier) {
                return buffer + v.identifier;
            } else {
                return buffer + ' ';
            }
        },
        function (buffer) {
            return buffer + '\n';
        });
}

function printAndIdentifyToHeightMap(heightMap, dataToPlot, scale, identifier) {
    dataToPlot.forEach(chain => {
        var pi = 0;
        for (var i = 1; i < chain.length; i++) {
            plot2D(heightMap, chain[i - 1], chain[i], scale, identifier);
        };
    });
}

function getMaskFromHeightMapByID(heightMap, scale, identifier) {
    var csgs = [];
    var xkeys = Object.keys(heightMap).filter(function (x) { return x != 'ykeys' }).sort(function (a, b) { return a - b });
    var ykeys = Object.keys(heightMap['ykeys']).sort(function (a, b) { return b - a });
    for (var yk of ykeys) {
        for (var xk of xkeys) {
            var v = getxy(heightMap, xk, yk);
            if (v && v.identifier == identifier) {
                var cube = CSG.cube().scale([0.5, 0.5, 0.5]); // -0.5 .. 0.5
                cube = cube.scale([scale, scale, printConfig.desiredBounds.max[2]]); // all the way up
                cube = cube.translate([xk * scale, yk * scale, 0]) // matches up the rounding
                csgs.push(cube);
            }
        }
    }
    return union(csgs);
}

void async function () {

    let dataToPlot1 = await getCachedDataToPlot(config);
    var bounds1 = getBounds(dataToPlot1);

    config.origin = "8516 Brookside Drive West 40056";
    let dataToPlot2 = await getCachedDataToPlot(config);
    var bounds2 = getBounds(dataToPlot2);

    var bounds3 = getBiggestBounds(bounds1, bounds2);

    var scaled1 = scaleDataToPlot(dataToPlot1, bounds3, printConfig.desiredBounds);
    var scaled2 = scaleDataToPlot(dataToPlot2, bounds3, printConfig.desiredBounds);

    // This stuff doesn't work.   Problem is that CSG breaks down and the intersections
    // end up ... aint right. 
    var heightMap = {}; 
    printAndIdentifyToHeightMap(heightMap, scaled1,5,'3');
    printAndIdentifyToHeightMap(heightMap, scaled2,5,'8');
    console.log(dumpHeightMapByID(heightMap));
    var mask8 = getMaskFromHeightMapByID(heightMap,5,'8');
    jscad.renderFile(mask8,'8516_mask.stl');
    var mask3 = getMaskFromHeightMapByID(heightMap,5,'3');
    jscad.renderFile(mask3,'335_mask.stl');

    var print1 = getRampPrint(scaled1);
    //  Not this -- this uses a serial one, lots of wasted CPU: 
    // print1 = union(print1);
    
    // instead this: 
    var a0 = print1.pop(); 
    print1 = a0.union(print1); 

    jscad.renderFile(print1, '335.stl');
    jscad.renderFile(print1.subtract(mask8),'335_masked.stl');

    var print2 = getRampPrint(scaled2); 
    a0 = print2.pop(); 
    print2 = a0.union(print2); 
    jscad.renderFile(print2, '8516.stl'); 
    jscad.renderFile(print2.subtract(mask3),'8516_masked.stl');

    console.log("done");
}();

