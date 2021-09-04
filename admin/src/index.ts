import "reflect-metadata";
import express, { Request, Response } from "express";
import cors from "cors";
import amqp from "amqplib/callback_api";

import { createConnection, getConnection } from "typeorm";
import { Product } from "./entity/Product";

createConnection()
  .then((connection) => {
    const ProductRepository = connection.getRepository(Product);
    console.log("Connected to db");

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

          const app = express();
          const PORT = process.env.PORT || 3001;

          app.use(express.json());
          app.use(cors());

          app.get("/api/products", async (req: Request, res: Response) => {
            const Products = await ProductRepository.find();
            res.status(200).json(Products);
          });

          app.post("/api/products", async (req: Request, res: Response) => {
            const Products = await ProductRepository.create(req.body);
            const result = await ProductRepository.save(Products);
            channel.sendToQueue(
              "product_created",
              Buffer.from(JSON.stringify(result))
            );
            res.status(201).json(result);
          });

          app.get("/api/products/:id", async (req: Request, res: Response) => {
            const Products = await ProductRepository.findOne(req.params.id);
            res.status(200).json(Products);
          });

          app.put("/api/products/:id", async (req: Request, res: Response) => {
            /**
             * please ensure to return the new update
             * as the one below doesn't
             */
            const result = await getConnection()
              .createQueryBuilder()
              .update(Product)
              .set(req.body)
              .where("id = :id", { id: req.params.id })
              .execute();
            if (result.affected === 1) {
              channel.sendToQueue(
                "product_updated",
                Buffer.from(JSON.stringify(req.body))
              );
              return res.status(200).json(result);
            }
          });

          app.delete(
            "/api/products/:id",
            async (req: Request, res: Response) => {
              const result = await getConnection()
                .createQueryBuilder()
                .delete()
                .from(Product)
                .where("id = :id", { id: req.params.id })
                .execute();
              channel.sendToQueue(
                "product_deleted",
                Buffer.from(req.params.id)
              );

              return res.status(200).json(result);
            }
          );

          app.post(
            "/api/products/:id/like",
            async (req: Request, res: Response) => {
              const product = await ProductRepository.findOne(req.params.id);
              product!.likes++;
              const result = await ProductRepository.save(product!);
              return res.status(200).json(result);
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
