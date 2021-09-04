import "reflect-metadata";
import express, { Request, Response } from "express";
import cors from "cors";
import { createConnection } from "typeorm";
import amqp from "amqplib/callback_api";
import axios from "axios";

import { Product } from "./entity/Product";

createConnection()
  .then(async (connection) => {
    console.log("Connected to db");
    const ProductRepository = connection.getMongoRepository(Product);

    function startServer() {
      amqp.connect(`${process.env.cloudamqp}`, (err, conn) => {
        if (err) {
          console.error("[AMQP]", err.message);
          return setTimeout(startServer, 1000);
        }

        conn.on("error", function (err) {
          if (err.message !== "Connection closing") {
            console.error("[AMQP] conn error", err.message);
          }
        });

        conn.on("close", function () {
          console.error("[AMQP] reconnecting");
          return setTimeout(startServer, 1000);
        });

        //creating a channel and wrapping the entire express application
        //and restarting the entire process if any failure occurs
        conn.createChannel((err, channel) => {
          if (err) {
            console.error("[AMQP] reconnecting <createChannel>");
            return setTimeout(startServer, 1000);
          }

          channel.assertQueue("product_created", { durable: false });
          channel.assertQueue("product_updated", { durable: false });
          channel.assertQueue("product_deleted", { durable: false });

          const app = express();
          const PORT = process.env.PORT || 3002;

          app.use(express.json());
          app.use(cors());

          channel.consume(
            "product_created",
            async (message) => {
              const eventProduct = JSON.parse(message!.content.toString());
              const product = new Product();
              product.admin_id = eventProduct.id;
              product.title = eventProduct.title;
              product.image = eventProduct.image;
              product.likes = eventProduct.likes;

              await ProductRepository.save(product);
              console.log("Product created");
            },
            { noAck: true }
          );

          channel.consume(
            "product_updated",
            async (message) => {
              try {
                const eventProduct = JSON.parse(message!.content.toString());
                await ProductRepository.update(
                  { admin_id: eventProduct.id },
                  {
                    title: eventProduct.title,
                    image: eventProduct.image,
                    likes: eventProduct.likes,
                  }
                );
              } catch (error) {
                console.log(error);
              }
            },
            { noAck: true }
          );

          channel.consume(
            "product_deleted",
            async (message) => {
              try {
                //ensure the message is converted to string
                const id = parseInt(message!.content.toString());
                console.log(id);
                await ProductRepository.deleteOne({ admin_id: id });
                console.log("product deleted");
              } catch (err) {
                console.log(err);
              }
            },
            { noAck: true }
          );

          app.get("/api/products", async (req: Request, res: Response) => {
            try {
              const products = await ProductRepository.find();
              res.status(200).json(products);
            } catch (error) {
              res.status(500).json(err);
            }
          });

          app.post(
            "/api/products/:id/like",
            async (req: Request, res: Response) => {
              try {
                const product = await ProductRepository.findOne(req.params.id);
                await axios.post(
                  `http://localhost:3001/api/products/${product!.admin_id}/like`
                );
                product!.likes++;
                await ProductRepository.save(product!);
                return res.status(200).json(product);
              } catch (error) {
                res.status(500).json(err);
              }
            }
          );

          app.listen(PORT, () => console.log(`App running on PORT ${PORT}`));
          process.on("beforeExit", () => {
            console.log("closing");
            connection.close();
          });
        });
      });
    }

    startServer();
  })
  .catch((error) => console.log(error));
