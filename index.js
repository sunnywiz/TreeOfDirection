const bluebird = require('bluebird');
const jscad = require('jscad');
const polyline = require('polyline');
const config = {
    origin: "8516 Brookside Drive West 40056",
    desiredBounds: { min: [0, 100, 0], max: [100, 0, 50] },
    maxLatLng: [38.317138, -85.463906],
    minLatLng: [38.294255, -85.501226],
    steps: [1, 1],
    printRadius: 1
};
const googleMapsClient = require('@google/maps').createClient({
    key: process.env.GOOGLE_MAPS_API_KEY,
    Promise: Promise
});

function addDirectionsToPlot(dataToPlot, result) {
    result.routes.forEach(route => {
        console.log("route: ", route.summary);
        var currentDuration = 0;
        route.legs.forEach(leg => {

            var chain = [];

            leg.steps.forEach(step => {

                if (step.travel_mode != "DRIVING") {
                    return;
                }

                var polyLinePoints = polyline.decode(step.polyline.points);
                var durationPerPoint = step.duration.value / (polyLinePoints.length - 1);
                var newDuration = currentDuration + step.duration.value;

                for (var pi = 0; pi < polyLinePoints.length; pi++) {
                    var x = polyLinePoints[pi][0];
                    var y = polyLinePoints[pi][1];

                    chain.push([x, y, currentDuration + durationPerPoint * pi]);
                }
                currentDuration = newDuration;
            })

            dataToPlot.push(chain);
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

var latlng = [];
var latstep = (config.maxLatLng[0] - config.minLatLng[0]) / config.steps[0];
var lngstep = (config.maxLatLng[1] - config.minLatLng[1]) / config.steps[1];
for (var lat = config.minLatLng[0]; lat <= config.maxLatLng[0]; lat += latstep) {
    for (var lng = config.minLatLng[1]; lng <= config.maxLatLng[1]; lng += lngstep) {
        latlng.push([lat, lng]);
    }
}

var dataToPlot = [];

bluebird.map(
    latlng,
    function (ll, i, l) {
        console.log("Getting directions to ", ll);
        return googleMapsClient.directions({
            origin: config.origin,
            destination: ll,
            alternatives: false
        }).asPromise()
    }
).then(data => {
    console.log("plotting");
    data.forEach(response => addDirectionsToPlot(dataToPlot, response.json));

    var bounds = getBounds(dataToPlot);
    console.log("bounds: ", bounds);

    dataToPlot.forEach(chain => {
        chain.forEach(segment => {
            pointScale(segment, bounds, config.desiredBounds);
        });
    });
    console.log("newbounds: ", getBounds(dataToPlot));

    var model = [];
    dataToPlot.forEach(chain => {

        for (var i=1; i<chain.length; i++) { 

            var cylinder = new CSG.roundedCylinder({
                start: chain[i-1],
                end: chain[i],
                radius: config.printRadius / 2
            });
            model.push(cylinder);
        };
    });
    jscad.renderFile(model, 'output.stl')
});