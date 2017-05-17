const jscad = require('jscad');

const config = {
    desiredBounds: { min: [0, 0, 0], max: [100, 100, 50] },
    printRadius: 2
};

const googleMapsClient = require('@google/maps').createClient({
    key: process.env.GOOGLE_MAPS_API_KEY,
    Promise: Promise
});

function doSomething(dataToPlot, result) {
    result.routes.forEach(route => {
        console.log("route: ", route.summary);
        var currentDuration = 0;
        route.legs.forEach(leg => {
            leg.steps.forEach(step => {
                var newDuration = currentDuration + step.duration.value;
                dataToPlot.push({
                    start: [step.start_location.lat, step.start_location.lng, currentDuration],
                    end: [step.end_location.lat, step.end_location.lng, newDuration]
                });
                currentDuration = newDuration;
            })
        })
    });
}

var dataToPlot = [];

function getBounds(dataToPlot) {
    var bounds = { min: dataToPlot[0].start.slice(0), max: dataToPlot[0].end.slice(0) };
    dataToPlot.forEach(segment => {
        if (segment.start[0] < bounds.min[0]) bounds.min[0] = segment.start[0];
        if (segment.start[1] < bounds.min[1]) bounds.min[1] = segment.start[1];
        if (segment.start[2] < bounds.min[2]) bounds.min[2] = segment.start[2];
        if (segment.start[0] > bounds.max[0]) bounds.max[0] = segment.start[0];
        if (segment.start[1] > bounds.max[1]) bounds.max[1] = segment.start[1];
        if (segment.start[2] > bounds.max[2]) bounds.max[2] = segment.start[2];
        if (segment.end[0] < bounds.min[0]) bounds.min[0] = segment.end[0];
        if (segment.end[1] < bounds.min[1]) bounds.min[1] = segment.end[1];
        if (segment.end[2] < bounds.min[2]) bounds.min[2] = segment.end[2];
        if (segment.end[0] > bounds.max[0]) bounds.max[0] = segment.end[0];
        if (segment.end[1] > bounds.max[1]) bounds.max[1] = segment.end[1];
        if (segment.end[2] > bounds.max[2]) bounds.max[2] = segment.end[2];
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

googleMapsClient.directions({
    origin: "8516 Brookside Drive West 40056",
    destination: "9300 Shelbyville Rd",
    alternatives: true
}).asPromise()
    .then(response =>
        doSomething(dataToPlot, response.json)
    ).then(x => {

        var bounds = getBounds(dataToPlot);
        console.log("bounds: ",bounds);

        dataToPlot.forEach(segment => {
            pointScale(segment.start, bounds, config.desiredBounds);
            pointScale(segment.end, bounds, config.desiredBounds);
        });
        console.log("newbounds: ",getBounds(dataToPlot));

        var model = [];
        dataToPlot.forEach(segment => {
            var cylinder = new CSG.roundedCylinder({
                start: segment.start,
                end: segment.end,
                radius: config.printRadius/2
            });
            model.push(cylinder);
        });
        jscad.renderFile(model, 'output.stl')
    });