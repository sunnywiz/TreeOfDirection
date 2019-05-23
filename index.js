'use strict'

const bluebird = require('bluebird');
const jscad = require('jscad');
const polyline = require('polyline');
const hash = require('object-hash');
const fs = require('fs');
const util = require('util');

const config = {
    origin: "335 Central Avenue 40056",
    desiredBounds: { min: [0, 0, 0], max: [100, 100, 100] },
    maxLatLng: [38.425, -85.344],
    minLatLng: [38.259, -85.641],
    steps: [25, 25],
    printRadius: 1, // in units of desired bounds
    cacheDir: "./cache"
};

const googleMapsClient = require('@google/maps').createClient({
    key: process.env.GOOGLE_MAPS_API_KEY,
    Promise: Promise
});

function addLocation(locations, lat, lng) {
    let key = hash([lat, lng]);
    locations[key] = [lat, lng];
}

function checkContainsLocation(locations, lat, lng) { 
    let key = hash([lat, lng]);
    return locations.hasOwnProperty(key);
}

function addDirectionsToPlot(dataToPlot, visitedLocations, result) {
    result.routes.forEach(route => {
        console.log("route: ", route.summary);
        var currentDuration = 0;
        route.legs.forEach(leg => {

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
    for (var i = 0; i < 3; i++) {
        var a = point[i] - bounds.min[i];  // zero-base it
        var b = a / (bounds.max[i] - bounds.min[i]); // 0..1 
        var c = b * (desiredBounds.max[i] - desiredBounds.min[i]);  // 0..x
        var d = c + desiredBounds.min[i];
        point[i] = d;
    }
}

async function cachedGoogleGetDirections(options) {
    let file = config.cacheDir + "/googleDirections." + hash(options) + ".json";
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
    var latstep = (config.maxLatLng[0] - config.minLatLng[0]) / config.steps[0];
    var lngstep = (config.maxLatLng[1] - config.minLatLng[1]) / config.steps[1];
    var most = { distance: 0, x: null, y: null };
    for (var lat = config.minLatLng[0]; lat <= config.maxLatLng[0]; lat += latstep) {
        for (var lng = config.minLatLng[1]; lng <= config.maxLatLng[1]; lng += lngstep) {

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

var dataToPlot = [];
var visitedLocations = {};
var ruledOutLocations = {};

void async function () {

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
    var maxLocations = (config.steps[0]+1) * (config.steps[1]+1);
    do {
        console.log("locating next point.. visitedLocations " + Object.keys(visitedLocations).length +" ruledOutLocations "+Object.keys(ruledOutLocations).length+" of "+maxLocations);
        let nextStop = chooseNextUnvisitedLocation(visitedLocations, ruledOutLocations, minDistance);
        console.log(util.format("Found distance %d percent", (nextStop.distance / minDistance) * 100));
        if (nextStop.distance < minDistance) {
            console.log("No more closer points found");
            break;
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

    var bounds = getBounds(dataToPlot);

    console.log("bounds: ", bounds);

    dataToPlot.forEach(chain => {
        chain.forEach(segment => {
            pointScale(segment, bounds, config.desiredBounds);
        });
    });
    console.log("newbounds: ", getBounds(dataToPlot));

    var minResolutionSq = Math.pow(config.printRadius * 6, 2);

    var model = [];
    dataToPlot.forEach(chain => {

        var pi = 0;
        for (var i = 1; i < chain.length; i++) {

            var dsq = Math.pow(chain[i][0] - chain[pi][0], 2) +
                Math.pow(chain[i][1] - chain[pi][1], 2) +
                Math.pow(chain[i][2] - chain[pi][2], 2);
            if (dsq > minResolutionSq || i == chain.length - 1) {

                var cylinder = new CSG.roundedCylinder({
                    start: chain[pi],
                    end: chain[i],
                    radius: config.printRadius / 2,
                    resolution: 4
                });
                model.push(cylinder);
                pi = i;
            }
        };
    });
    jscad.renderFile(model, 'output.stl');

}();

