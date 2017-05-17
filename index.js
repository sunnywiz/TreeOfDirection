const jscad = require('jscad');
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
                console.log(step.start_location, currentDuration, step.end_location, newDuration);
                dataToPlot.push( {
                    start: [step.start_location.lat, step.start_location.lng, currentDuration/1000 ],
                    end:   [step.end_location.lat,   step.end_location.lng,   newDuration/1000 ]
                }); 
                currentDuration = newDuration; 
            })
        })
    });
}

var dataToPlot = [];

googleMapsClient.directions({
    origin: "8516 Brookside Drive West 40056",
    destination: "9300 Shelbyville Rd",
    alternatives: true
}).asPromise()
    .then(response =>
        doSomething(dataToPlot, response.json)
    ).then(x=>{
        var model = [];
        dataToPlot.forEach(segment=>{ 
            var cylinder = new CSG.roundedCylinder({ 
                start: segment.start,
                end: segment.end,
                radius: 0.01
            });
            model.push(cylinder);
        });
        jscad.renderFile(model,'output.stl')
    });