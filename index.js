const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion } = require('mongodb');

const app = express();
const port = process.env.PORT || 5000;

//Middleware
app.use(cors());
app.use(express.json());


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.n6iyx.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });


async function run() {
    try {
        await client.connect();
        const serviceCollection = client.db("doctors_portal").collection("services");
        const bookingCollection = client.db("doctors_portal").collection("bookings");

        app.get('/service', async (req, res) => {
            const query = {};
            const cursor = serviceCollection.find(query);
            const services = await cursor.toArray();
            res.send(services);
        });

        //This is not the proper way to query
        //after learning more about Mongodb.use aggregate lookup,pipeline,match,group.

        app.get('/available', async (req, res) => {
            const date = req.query.date || "May 15, 2022";

            //Step-1: get all the services
            const services = await serviceCollection.find().toArray();
            //Step-2: get booking of that day
            const query = { date: date };
            const bookings = await bookingCollection.find(query).toArray();
            //Step-3: forEach services ,find booking for that days
            services.forEach(service => {
                //step-4: find bookings for that service
                const serviceBookings = bookings.filter(book => book.treatment === service.name);
                //select slots for the service booking
                const bookedSlots = serviceBookings.map(book => book.slot);
                //select those slot what are not in booked slots
                const available = service.slots.filter(slot => !bookedSlots.includes(slot));
                service.slots = available;
            });
            res.send(services);
        })

        /**
         * API Naming Convention
         * app.get('/booking') //get all boking of this collection or get more than one or get by filter query.
         * app.get('/booking/:id') //get a specific booking.
         *  app.post('/booking/:id') // add a booking.
         *  app.patch('/booking/:id') //update a booking.
         *  app.delete('/booking/:id') // delete a api.
         **/

        app.get('/booking', async (req, res) => {
            const patient = req.query.patient;
            const query = { patient: patient };
            const bookings = await bookingCollection.find(query).toArray();
            res.send(bookings);
        })
        app.post('/booking', async (req, res) => {
            const booking = req.body;
            const query = { treatment: booking.treatment, date: booking.date, patient: booking.patient };
            const exists = await bookingCollection.findOne(query);
            if (exists) {
                return res.send({ success: false, booking: exists })
            }
            const result = await bookingCollection.insertOne(booking);
            res.send({ success: true, result });
        });

    }
    finally {

    }
};

run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Hello from Doctors portal!')
});

app.listen(port, () => {
    console.log(`Doctors portal listening on port ${port}`)
});