const gmaps = require('@google/maps');

// i don't know the right casing Conventions
// https://stackoverflow.com/questions/32657516/how-to-export-a-es6-class-properly-in-node-4
// http://javascriptplayground.com/blog/2014/07/introduction-to-es6-classes-tutorial/
// https://github.com/DrkSephy/es6-cheatsheet

class CommandsQueries {

    constructor() {
        if (!process.env.GOOGLE_MAPS_API_KEY) {
            throw 'missing enviornment variable GOOGLE_MAPS_API_KEY';
        }
        this.googleMapsClient = gmaps.createClient({
            key: process.env.GOOGLE_MAPS_API_KEY,
            Promise: Promise
        });
    }

    async GeocodeAsync(address) {
        // https://stackoverflow.com/questions/26096030/adding-a-promise-to-a-google-maps-api-call
        var r = await (this.googleMapsClient.geocode({
            address: address
        })).asPromise();
        if (r.json.status != "OK") {
            console.log(r.json);
            throw ("Geocode returned " + r.json.status);
        } 
        return r.json.results[0].geometry.location;
    }


}

module.exports.CommandsQueries = CommandsQueries; 