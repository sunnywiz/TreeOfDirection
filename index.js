'use strict'

const bluebird = require('bluebird');
const jscad = require('jscad');
const polyline = require('polyline');
const hash = require('object-hash');
const fs = require('fs');
const util = require('util');

const config = {
    origin: "335 Central Avenue 40056",
    maxLatLng: [38.425, -85.344],
    minLatLng: [38.259, -85.641],
//    steps: [50, 50],
    steps: [10,10]
};

const runConfig = { 
    cacheDir: "./cache"
}

const printConfig = { 
    // these are the limits of the printer
    desiredBounds: { min: [0, 0, 0], max: [100, 100, 50] },
    printRadius: 1, // in units of desired bounds -- determines cylinder thickness
}

const tessConfig = { 
    // these are x,y Math.Round(ed) so # of divisions.  height doesn't matter as much
    desiredBounds: { min: [0,0,0], max:[50,50,50]}
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
    var maxLocations = (config.steps[0]+1) * (config.steps[1]+1);
    do {
        console.log("locating next point.. visitedLocations " + Object.keys(visitedLocations).length +" ruledOutLocations "+Object.keys(ruledOutLocations).length+" of "+maxLocations);
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

function rescale(dataToPlot, desiredBounds) { 
    var bounds = getBounds(dataToPlot);
    console.log("bounds: ", bounds);
    dataToPlot.forEach(chain => {
        chain.forEach(segment => {
            pointScale(segment, bounds, desiredBounds);
        });
    });
    console.log("newbounds: ", getBounds(dataToPlot));        
} 

function doCylinderPrint(dataToPlot) { 
    // assumes you have already scaled it to print bounds
    var minResolutionSq = Math.pow(printConfig.printRadius * 6, 2);

    var model = [];
    dataToPlot.forEach(chain => {

        var pi = 0;
        for (var i = 1; i < chain.length; i++) {

            var dsq = Math.pow(chain[i][0] - chain[pi][0], 2) +
                Math.pow(chain[i][1] - chain[pi][1], 2) +
                Math.pow(chain[i][2] - chain[pi][2], 2);
            if (dsq > minResolutionSq || i == chain.length - 1) {

                var cylinder = new CSG.cylinder({
                    start: chain[pi],
                    end: chain[i],
                    radius: printConfig.printRadius / 2,
                    resolution: 4
                });
                model.push(cylinder);
                pi = i;
            }
        };
    });
    jscad.renderFile(model, 'output.stl');
}

function setxy(a,x,y,v) { 
    if (typeof a !== 'object' || a === null) throw "1st parameter must be an object";
    var b = a[x]; 
    if (typeof a['ykeys'] !== 'object') a['ykeys'] = {}; 
    if (typeof b !== 'object' || b === null) { 
        b = {}; 
        a[x] = b; 
    }
    a['ykeys'][y]=y;
    b[y] = v; 
}
function getxy(a,x,y) { 
    if (typeof a !== 'object' || a === null) throw "1st parameter must be an object"; 
    var b = a[x]; 
    if (typeof b !== 'object' || b === null) return undefined; 
    return b[y]; 
}

function plot2D(heightMap, start, end) { 
    var x1 = start[0]; 
    var y1 = start[1];
    var h1 = start[2]; 
    var x2 = end[0];
    var y2 = end[1];
    var h2 = end[2]; 

    var dx = Math.abs(x1-x2);
    var dy = Math.abs(y1-y2); 

    if (dx<0.5 && dy < 0.5) {  
        var x = Math.round((x1+x2)/2.0);
        var y = Math.round((y1+y2)/2.0);
        var height = (h1+h2)/2.0;  
        var c = getxy(heightMap, x, y); 
        if (c && c.height && c.height < height) return;   // already good

        setxy(heightMap, x, y, { height: height, locked: 1});
    } else { 
        // divide into two! 
        var mx = (start[0]+end[0])/2.0; 
        var my = (start[1]+end[1])/2.0; 
        var mh = (h1+h2)/2.0; 
        plot2D(heightMap, start, [mx,my,mh]);
        plot2D(heightMap, [mx,my,mh], end);
    }
}

function iteratexy(heightMap, finit, fxy, fendx) { 
    var xkeys = Object.keys(heightMap).filter(function(x) { return x != 'ykeys'}).sort(function(a,b) { return a-b }); 
    var ykeys = Object.keys(heightMap['ykeys']).sort(function(a,b) { return a-b});
    var buffer = finit();  
    for (var yk of ykeys) { 
        for (var xk of xkeys) { 
            var v = getxy(heightMap,xk,yk); 
            buffer = fxy(buffer, v); 
        }
        buffer = fendx(buffer); 
    }
    return buffer; 
}

function dumpHeightMap(heightMap) { 
    // this should be two functions

    var legend = ".,:;oxOX#$";
    var legendLength = legend.length-1; 
    var minHeight = tessConfig.desiredBounds.min[2]; 
    var maxHeight = tessConfig.desiredBounds.max[2]; 

    return iteratexy(heightMap, 
        function() { return '';},
        function(buffer, v) { 
            if (v && v.height) { 
                var h = v.height; 
                h = Math.round((h - minHeight) / (maxHeight-minHeight) * legendLength); 
                if (h<0) h = 0; 
                if (h > legendLength) h = legendLength;
                return buffer + ' ' + legend.charAt(h); 
            } else { 
                return buffer + '  ';
            }
            return buffer; 
        }, 
        function(buffer) { 
            return buffer + '\n'; 
        }); 
}

function tess(dataToPlot) { 
    rescale(dataToPlot, tessConfig.desiredBounds);

    var heightMap = {}; 

    dataToPlot.forEach(chain => {
        var pi = 0;
        for (var i = 1; i < chain.length; i++) {
            plot2D(heightMap, chain[i-1], chain[i]);
        };
    });

    console.log(dumpHeightMap(heightMap)); 
}

void async function () {

    let dataToPlot = await getCachedDataToPlot(config); 

    // var clone1 = JSON.parse(JSON.stringify(dataToPlot));
    // rescale(clone1, printConfig.desiredBounds); 
    // doCylinderPrint(dataToPlot);

    tess(dataToPlot); 


}();

