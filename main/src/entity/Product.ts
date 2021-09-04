import { Entity, ObjectIdColumn, ObjectID, Column } from "typeorm";

@Entity()
export class Product {
  @ObjectIdColumn()
  id!: ObjectID;

  @Column({ unique: true })
  admin_id!: number;

  @Column()
  title!: string;

  @Column()
  image!: string;

  @Column({ default: 0 })
  likes!: number;
}
