'use strict'

const jscad = require('jscad');
const polyline = require('polyline');
const hash = require('object-hash');
const fs = require('fs');
const util = require('util');

const config = {
    origin: "8516 Brookside Drive West 40056",
    minLatLng: [38.210, -85.678],  // must be smaller numbers than maxLatLng
    maxLatLng: [38.342, -85.447],
    steps: [5, 5],
}

const runConfig = {
    cacheDir: "./cache"
}

const printConfig = {
    // these are the limits of the printer .. mm ? 
    // MUST START at 0,0,0 for now
    desiredBounds: { min: [0, 0, 0], max: [100, 100, 50] },
    printRadius: 1, // in units of desired bounds -- determines cylinder thickness
    minThickness: 1,
    surfaceOffset: 0
}

const tessConfig = {
    // these are x,y Math.Round(ed) so # of divisions.  height doesn't matter as much
    // MUST start at 0,0,0
    desiredBounds: { min: [0, 0, 0], max: [50, 50, 50] }
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
            var i = leg.steps.length - 1;
            while (i > 5) {
                if (leg.steps[i].duration.value < 120 &&
                    leg.steps[i].distance.value < 1609) {
                    leg.steps.pop();
                    i--;
                    continue;
                } else {
                    break;
                }
            }

            leg.steps.forEach(step => {

                var chain = [];

                if (step.travel_mode != "DRIVING") {
                    return;
                }

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

function getRamp(start, end, thick) {
    var s = new CSG.Vector3D(start);
    var sb = new CSG.Vector3D([s._x, s._y, 0]);
    var e = new CSG.Vector3D(end);
    var eb = new CSG.Vector3D([e._x, e._y, 0]);

    var direction = e.minus(s).unit();
    var d = new CSG.Vector3D(direction._x, direction._y, 0);
    var n = new CSG.Vector3D([0, 0, 10]); // straight up
    var crossed = direction.cross(n).unit().times(thick / 2); // to the clockwise

    return CSG.polyhedron({
        points: [
            s.minus(crossed),
            e.minus(crossed).plus(d),
            e.plus(crossed).plus(d),
            s.plus(crossed),
            sb.minus(crossed),
            eb.minus(crossed).plus(d),
            eb.plus(crossed).plus(d),
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
}

function getRampPrint(dataToPlot) {

    var minResolutionSq = Math.pow(printConfig.printRadius * 4, 2);

    var model = [];
    dataToPlot.forEach(chain => {

        var pi = 0;
        for (var i = 1; i < chain.length; i++) {

            var dsq = Math.pow(chain[i][0] - chain[pi][0], 2) +
                Math.pow(chain[i][1] - chain[pi][1], 2) +
                Math.pow(chain[i][2] - chain[pi][2], 2);
            if (dsq > minResolutionSq || i == chain.length - 1) {

                var ramp = getRamp(chain[pi], chain[i], printConfig.printRadius);
                model.push(ramp);
                pi = i;
            }
        };
    });
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

void async function () {

    config.origin = "8516 Brookside Drive West 40056";

    let dataToPlot1 = await getCachedDataToPlot(config);
    var bounds1 = getBounds(dataToPlot1);

    config.origin = "335 Central Ave 40056";
    let dataToPlot2 = await getCachedDataToPlot(config);
    var bounds2 = getBounds(dataToPlot2);

    var bounds3 = getBiggestBounds(bounds1, bounds2);

    var scaled1 = scaleDataToPlot(dataToPlot1, bounds3, printConfig.desiredBounds);
    var print1 = getRampPrint(scaled1);
    jscad.renderFile(print1, '8516.stl');

    var scaled2 = scaleDataToPlot(dataToPlot2, bounds3, printConfig.desiredBounds);
    var print2 = getRampPrint(scaled2); 
    jscad.renderFile(print2, '335.stl'); 

    // Nope, this doesn't work.  The solids aren't solid enough :( 
    // var cube = CSG.cube().scale(printConfig.desiredBounds.max);
    // console.log("starting unions");
    // var a1 = union(print1); 
    // var a2 = union(print2); 
    // console.log("done with unions");
    // jscad.renderFile(cube, 'cube.stl');
    // var neg1 = cube.subtract(a1); 
    // jscad.renderFile(neg1, 'neg1.stl');
    // var neg2 = cube.subtract(a2); 
    // jscad.renderFile(neg2, 'neg2.stl');

    // var uneg = union(neg1, neg2); 
    // jscad.renderFile(uneg,'uneg.stl');

    console.log("done");
}();

