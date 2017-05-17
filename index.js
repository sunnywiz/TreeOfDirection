var googleMapsClient = require('@google/maps').createClient({
    key: process.env.GOOGLE_MAPS_API_KEY,
    Promise: Promise
});

function doSomething(result) {

    result.routes.forEach(route => {
        console.log("route: ",route.summary);
        var currentDuration = 0; 
        route.legs.forEach(leg => {
            leg.steps.forEach(step => {
                var newDuration = currentDuration + step.duration.value; 
                console.log(step.start_location, currentDuration, step.end_location, newDuration);
                currentDuration = newDuration; 
            })
        })
    });
}

googleMapsClient.directions({
    origin: "8516 Brookside Drive West 40056",
    destination: "9300 Shelbyville Rd",
    alternatives: true
}).asPromise()
    .then(response =>

        doSomething(response.json)
    
    
    
    
    
     );